// Scenarios A–D. A is the control group (Pi's CodingTools on a plain directory); B–D run the LayerFS tools
// (lfs-scenarios.ts), each in its own project's client container. `npm run demo1` runs all; `npm run demo1 -- A` one.
// Each scenario compares against a clean run of the same script.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { scenarioInClient } from "../shared/container.ts";
import { type HostEvent, type HostRun, runHost } from "../shared/driver.ts";
import { check, driverEvent, fact, note, scenario, summary } from "../shared/report.ts";

const ROOT = resolve(import.meta.dirname, "..");
const HOST = join(ROOT, "demo1/host.ts");
export const KILL_AFTER_MS = 2000;

/** sha256 over the sorted (path, content) pairs of a directory. */
export function treeHash(files: Record<string, string>): string {
	const hash = createHash("sha256");
	for (const path of Object.keys(files).sort()) hash.update(`${path}\0${files[path]}\0`);
	return hash.digest("hex").slice(0, 16);
}

export function readTree(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	const walk = (at: string) => {
		for (const name of readdirSync(at)) {
			const path = join(at, name);
			if (statSync(path).isDirectory()) walk(path);
			else files[relative(dir, path)] = readFileSync(path, "utf8");
		}
	};
	if (existsSync(dir)) walk(dir);
	return files;
}

export const lines = (text: string | undefined) => (text ?? "").split("\n").filter((line) => line !== "").length;
export const of = (events: readonly HostEvent[], kind: string) => events.filter((event) => event.event === kind);
export const exitOf = (run: HostRun) => (run.signal === null ? `exit ${run.code}` : run.signal);

export function freshRun(name: string): string {
	const runDir = join(ROOT, "runs", `demo1-${name}`);
	rmSync(runDir, { recursive: true, force: true });
	mkdirSync(join(runDir, "work"), { recursive: true });
	note(`run directory: ${runDir}`);
	return runDir;
}

/** Kill the host KILL_AFTER_MS after the first bash call starts. */
export function killDuringBash(onKill?: () => void) {
	let started: number | undefined;
	return (events: readonly HostEvent[]) => {
		if (started === undefined && events.some((event) => event.event === "call" && event.tool === "bash")) started = Date.now();
		if (started === undefined || Date.now() - started < KILL_AFTER_MS) return undefined;
		onKill?.();
		return "kill" as const;
	};
}

export const host = (label: string, runDir: string, env: Record<string, string>, tick?: Parameters<typeof runHost>[0]["tick"]) =>
	runHost({ label, script: HOST, runDir, env, ...(tick === undefined ? {} : { tick }) });

const SCENARIOS: Record<string, () => Promise<void>> = {
	async A() {
		scenario("A", "control group: kill bash 2 s in, restart", "the model gets interrupted; b.txt is left half-written");
		note("clean run first, for the reference tree");
		const cleanDir = freshRun("A-clean");
		await host("clean", cleanDir, { VARIANT: "baseline" });
		const clean = readTree(join(cleanDir, "work"));
		note(`clean tree ${treeHash(clean)}: b.txt has ${lines(clean["b.txt"])} lines`);
		fact("cleanHash", treeHash(clean));
		fact("cleanLines", lines(clean["b.txt"]));

		const runDir = freshRun("A");
		let atKill = 0;
		const first = await host("run 1", runDir, { VARIANT: "baseline" }, killDuringBash(() => {
			atKill = lines(readTree(join(runDir, "work"))["b.txt"]);
		}));
		check("run 1 killed mid-command", first.signal === "SIGKILL", exitOf(first));
		note(`b.txt when the process died: ${atKill} of 10 lines`);
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const later = lines(readTree(join(runDir, "work"))["b.txt"]);
		note(`b.txt 1 s later: ${later} lines${later > atKill ? " (the killed host's shell is an orphan and keeps writing)" : ""}`);
		fact("atKill", atKill);
		fact("later", later);
		driverEvent("restart");
		const second = await host("run 2", runDir, { VARIANT: "baseline" });
		const interrupted = of(second.events, "result").some((event) => event.tool === "bash" && /was interrupted/.test(String(event.text)));
		check("the model is told the command was interrupted", interrupted);
		const tree = readTree(join(runDir, "work"));
		const final = lines(tree["b.txt"]);
		note(`final tree ${treeHash(tree)}: b.txt has ${final} lines, the clean run ${lines(clean["b.txt"])}`);
		fact("final", final);
		fact("treeHash", treeHash(tree));
		fact("files", tree);
		fact("cleanFiles", clean);
		check("the files do not match the clean run", treeHash(tree) !== treeHash(clean), `${treeHash(tree)} vs clean ${treeHash(clean)}`);
	},
};

/** The LayerFS scenarios, each run by lfs-scenarios.ts in a client container with a fresh project. */
export const LAYERFS: Record<string, string> = {
	B: "LayerFS: kill bash 2 s in, restart",
	C: "LayerFS: crash right after the bash commit",
	D: "fork the finished run at its first tool result",
};

if (import.meta.main) {
	const wanted = process.argv.slice(2).map((name) => name.toUpperCase());
	for (const name of ["A", ...Object.keys(LAYERFS)]) {
		if (wanted.length > 0 && !wanted.includes(name)) continue;
		if (name in SCENARIOS) await SCENARIOS[name]!();
		else await scenarioInClient(name, LAYERFS[name]!, `demo1-${name.toLowerCase()}`, "demo1/lfs-scenarios.ts");
	}
	process.exit(summary() ? 0 : 1);
}
