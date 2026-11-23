// LayerFS's SDK opens the project's Store in its own process, and the Store lives in a Docker volume that only root
// can reach on this host. So everything that talks to LayerFS (the hosts, and the drivers that check their work) runs
// as root in a client container with that volume mounted, the Docker socket, and the repository at its own path, as
// s0/lfs.sh does. One project per volume: `lockstep-lfs-<project>`. The scenario drivers run inside the container and
// start, kill and restart their hosts there as ordinary child processes.
//
//   node shared/container.ts <project> <command...>     run one command in the project's client container
import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { adopt, TRACES } from "./report.ts";

const ROOT = resolve(import.meta.dirname, "..");
export const CLIENT_IMAGE = process.env.LOCKSTEP_CLIENT_IMAGE ?? "node:22-slim";
export const SANDBOX_IMAGE = process.env.LOCKSTEP_SANDBOX_IMAGE ?? "lockstep-sandbox:1";
export const DAEMON = join(ROOT, "vendor/layerfs/target/s0/layerfs-daemon");
const HOME_VOLUME = "lockstep-layerfs-home";
export const volumeOf = (project: string) => `lockstep-lfs-${project}`;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Why LayerFS cannot run here, or undefined when it can. */
export function unavailable(): string | undefined {
	if (!existsSync(DAEMON)) return `no LayerFS daemon at ${DAEMON}`;
	if (!existsSync(join(ROOT, "vendor/layerfs/engine/crates/layerfs-node/layerfs.node"))) return "no LayerFS native addon";
	try {
		docker("image", "inspect", "--format", "{{.Id}}", SANDBOX_IMAGE);
	} catch {
		return `no sandbox image ${SANDBOX_IMAGE} (npm run setup:lfs)`;
	}
	return undefined;
}

/**
 * Remove a project's Sandboxes and its Store volume, so the next client starts with no project of that name. The
 * project's discovery record in the shared home volume is removed by the client (see lfsEnv's caller).
 */
export function resetProject(project: string): void {
	const containers = docker("ps", "-aq", "--filter", `label=layerfs.project=${project}`).split("\n").filter(Boolean);
	if (containers.length > 0) docker("rm", "-f", ...containers);
	try {
		docker("volume", "rm", volumeOf(project));
	} catch {
		// No such volume: nothing to remove.
	}
}

/** `docker run` arguments for `command` in the project's client container. */
export function clientArgs(project: string, command: readonly string[], env: Record<string, string> = {}): string[] {
	const image = docker("image", "inspect", "--format", "{{.Id}}", SANDBOX_IMAGE);
	const settings: Record<string, string> = {
		LAYERFS_HOME: "/layerfs-home/home",
		LAYERFS_STORE_PATH: "/layerfs-store/global/store.sqlite",
		LAYERFS_VOLUME: volumeOf(project),
		LAYERFS_IMAGE: image,
		LAYERFS_DAEMON: DAEMON,
		LAYERFS_DOCKER: "/var/run/docker.sock",
		LAYERFS_CONTAINER_PREFIX: "lockstep-lfs-",
		LOCKSTEP_PROJECT: project,
		...(process.stdout.isTTY ? { LOCKSTEP_COLOR: "1" } : {}),
		...env,
	};
	return [
		"run", "--rm", "-i", "--network", "host",
		"--label", "lockstep.role=client",
		"-v", "/var/run/docker.sock:/var/run/docker.sock",
		"-v", `${volumeOf(project)}:/layerfs-store`,
		"-v", `${HOME_VOLUME}:/layerfs-home`,
		"-v", `${ROOT}:${ROOT}`, "-w", ROOT,
		...Object.entries(settings).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
		CLIENT_IMAGE,
		// Root writes the run directories; umask 0 leaves them removable by the user who owns the checkout.
		"sh", "-c", 'umask 0 && exec "$@"', "sh", ...command,
	];
}

/** Run `command` in the project's client container with inherited stdio; resolves with its exit code. */
export function inClient(project: string, command: readonly string[], env: Record<string, string> = {}): Promise<number> {
	const child = spawn("docker", clientArgs(project, command, env), { stdio: "inherit" });
	return new Promise((done) => child.on("exit", (code, signal) => done(code ?? (signal === null ? 1 : 128))));
}

/**
 * Run scenario `name` with a fresh project: `script <name>` in the project's client container, which writes the
 * scenario's trace; this process then takes it into its summary.
 */
export async function scenarioInClient(name: string, title: string, project: string, script: string, env: Record<string, string> = {}): Promise<void> {
	const why = unavailable();
	if (why !== undefined) return adopt(name, title, `LayerFS is not available here: ${why}`);
	resetProject(project);
	rmSync(join(TRACES, `${name}.json`), { force: true });
	await inClient(project, ["node", "--disable-warning=ExperimentalWarning", script, name], { LOCKSTEP_INNER: "1", ...env });
	adopt(name, title);
}

if (import.meta.main) {
	const [project, ...command] = process.argv.slice(2);
	if (project === undefined || command.length === 0) {
		console.error("usage: node shared/container.ts <project> <command...>");
		process.exit(2);
	}
	process.exit(await inClient(project, command));
}
