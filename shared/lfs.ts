// The LayerFS side of the commit protocol, over @layerfs/agent: one client per process, Sandboxes, finding a task's
// commit, and getting rid of what a killed process left behind. Everything here runs in a client container
// (shared/container.ts); LOCKSTEP_PROJECT names the project.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { type Commit, isRefusal, LayerFS, type Workspace, type WorkspaceEntry } from "@layerfs/agent";

export { isRefusal };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function projectName(): string {
	const name = process.env.LOCKSTEP_PROJECT;
	if (name === undefined) throw new Error("LOCKSTEP_PROJECT is not set: run this in a client container (shared/container.ts)");
	return name;
}

let client: Promise<LayerFS> | undefined;

/** The process's client of the project, opened on first use. */
export function lfs(): Promise<LayerFS> {
	client ??= LayerFS.open(projectName());
	return client;
}

export async function closeLfs(): Promise<void> {
	const open = client;
	client = undefined;
	sandbox = undefined;
	if (open !== undefined) await (await open).close();
}

/** Create the project from `folder` (its `main`), dropping any earlier project of the same name in this home. */
export async function initProject(folder: string): Promise<void> {
	await closeLfs();
	rmSync(join(process.env.LAYERFS_HOME ?? "", projectName()), { recursive: true, force: true });
	const created = await LayerFS.init(projectName(), folder);
	client = Promise.resolve(created);
}

/** Fork `name` from `from` unless it exists. */
export async function forkOnce(name: string, from = "main"): Promise<void> {
	try {
		await (await lfs()).branch.fork(name, from);
	} catch (error) {
		if (!isRefusal(error, "NameTaken")) throw error;
	}
}

export async function branchInfo(name: string) {
	return (await (await lfs()).project.list_branches(1000, 0)).items.find((branch) => branch.name === name);
}

/** The Branch's newest commit; null before its first. */
export async function head(branch: string): Promise<string | null> {
	const info = await branchInfo(branch);
	if (info === undefined) throw new Error(`No LayerFS branch ${branch}`);
	return info.head;
}

/** Every commit on the Branch newer than `base` (excluded), newest first. */
export async function commitsSince(branch: string, base: string | null): Promise<Commit[]> {
	const out: Commit[] = [];
	for (let pos = 0; ; ) {
		const page = await (await lfs()).branch.list_commits(branch, 100, pos);
		for (const commit of page.items) {
			if (commit.id === base) return out;
			out.push(commit);
		}
		if (!page.hasMore) return out;
		pos += page.items.length;
	}
}

/** The commit a tool call left: its message starts `pi-task:<taskId>`. */
export async function findTaskCommit(branch: string, base: string | null, taskId: number): Promise<Commit | undefined> {
	return (await commitsSince(branch, base)).find((commit) => commit.message.startsWith(`pi-task:${taskId}\n`));
}

/** `pi-task:<taskId>`, then `exit:<code>`, then the output tail: legal as a LayerFS message (at most 4096 bytes). */
export function taskMessage(taskId: number, exitCode: number, output: string): string {
	const clean = output
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
		.replace(/[\ud800-\udfff]/g, "�");
	const head = `pi-task:${taskId}\nexit:${exitCode}\n`;
	let tail = clean.slice(-2000);
	while (Buffer.byteLength(head + tail) > 4096) tail = tail.slice(Math.ceil(tail.length / 8));
	return head + tail;
}

export function parseTaskMessage(message: string): { exitCode: number; output: string } {
	const [, exit = "", ...rest] = message.split("\n");
	return { exitCode: Number(exit.replace(/^exit:/, "")), output: rest.join("\n") };
}

let sandbox: Promise<string> | undefined;

/** A running Sandbox with room, shared by the process: one that is running already, else a new one. */
function ensureSandbox(): Promise<string> {
	sandbox ??= (async () => {
		const client = await lfs();
		const count = (workspaces: number | unknown[]) => (typeof workspaces === "number" ? workspaces : workspaces.length);
		const running = (await client.project.list_sandboxes(100, 0)).items.find((entry) => count(entry.workspaces) < 12);
		return running?.sandbox ?? (await client.sandbox.create()).sandbox;
	})();
	return sandbox;
}

/** Mount a Workspace on the Branch. A Sandbox closes itself after two idle minutes; then a new one is made. */
export async function mount(branch: string): Promise<Workspace> {
	try {
		return await (await lfs()).workspace.mount(await ensureSandbox(), branch);
	} catch (error) {
		if (!isRefusal(error, "NoSuchSandbox")) throw error;
		sandbox = undefined;
		return (await lfs()).workspace.mount(await ensureSandbox(), branch);
	}
}

/** The Branch's mounted Workspaces, in every running Sandbox. */
export async function leftovers(branch: string): Promise<WorkspaceEntry[]> {
	const client = await lfs();
	const out: WorkspaceEntry[] = [];
	for (const { sandbox } of (await client.project.list_sandboxes(100, 0)).items) {
		out.push(...(await client.sandbox.list_workspaces(sandbox, 100, 0)).items.filter((ws) => ws.branch === branch));
	}
	return out;
}

/** Run `script` from a helper Workspace in `sandbox`: the same container, so it sees the other Workspaces' processes. */
async function inSandbox(sandbox: string, branch: string, script: string, message: string): Promise<string> {
	const client = await lfs();
	const helper = await client.workspace.mount(sandbox, branch);
	try {
		return (await client.workspace.exec(helper, script, message)).stdout;
	} finally {
		await client.workspace.unmount(helper, true);
	}
}

/**
 * SIGKILL every process whose working directory or an open file is inside the Workspace. SIGKILL of the host does not
 * reach a command it started in the Sandbox, and such an orphan keeps the mount busy.
 */
export async function killOrphans(ws: WorkspaceEntry): Promise<string[]> {
	const script = `p='${ws.path}'; for d in /proc/[0-9]*; do pid=\${d#/proc/}; [ "$pid" = "$$" ] && continue;
		c=$(readlink "$d/cwd" 2>/dev/null); hit=; case "$c" in "$p"|"$p"/*) hit=1;; esac
		[ -z "$hit" ] && ls -l "$d/fd" 2>/dev/null | grep -q -- "-> $p/" && hit=1
		[ -n "$hit" ] && { cmd=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null); kill -9 "$pid" 2>/dev/null && echo "$pid $cmd"; }; done; true`;
	const out = await inSandbox(ws.sandbox, ws.branch, script, "kill orphans");
	return out.split("\n").filter(Boolean);
}

/** Lines of `file` in a leftover Workspace, read from a helper beside it; for the scenarios' narration. */
export async function peekLines(ws: WorkspaceEntry, file: string): Promise<number> {
	const out = await inSandbox(ws.sandbox, ws.branch, `wc -l < '${ws.path}/${file}' 2>/dev/null || echo 0`, "peek");
	return Number(out.trim());
}

export type Discarded = { path: string; changed: boolean; killed: string[] };

/**
 * Unmount, discarding, every Workspace on the Branch: what a killed process left. A Workspace whose command still
 * runs is Busy; its orphans are killed first. Never force: a forced unmount while an orphan is alive fails at Detach
 * (EBUSY) and wedges the Workspace and its Sandbox.
 */
export async function discardLeftovers(branch: string): Promise<Discarded[]> {
	const client = await lfs();
	const done: Discarded[] = [];
	for (const ws of await leftovers(branch)) {
		const killed: string[] = [];
		for (let attempt = 1; ; attempt++) {
			try {
				await client.workspace.unmount({ sandbox: ws.sandbox, path: ws.path }, true);
				break;
			} catch (error) {
				if (!isRefusal(error, "Busy") || attempt === 5) throw error;
				killed.push(...(await killOrphans(ws)));
				await sleep(200);
			}
		}
		done.push({ path: `${ws.sandbox}:${ws.path}`, changed: ws.changed, killed });
	}
	return done;
}

/** Every file of a ref (a Branch, `main`, or a commit) as { relative path: text }. */
export async function readTree(ref: string): Promise<Record<string, string>> {
	const client = await lfs();
	const files: Record<string, string> = {};
	const walk = async (dir: string) => {
		for (let pos = 0; ; ) {
			const page = await client.fs.list(ref, dir, 1000, pos);
			for (const entry of page.items) {
				if (entry.type === "dir") await walk(entry.path);
				else if (entry.type === "file") files[entry.path.slice(1)] = await readFile(ref, entry.path);
			}
			if (!page.hasMore) return;
			pos += page.items.length;
		}
	};
	await walk("/");
	return files;
}

export async function readFile(ref: string, path: string): Promise<string> {
	const client = await lfs();
	let text = "";
	for (let line: number | null = 1; line !== null; ) {
		const window = await client.fs.read(ref, path, line, line + 1999);
		text += window.text;
		line = window.nextLine;
	}
	return text;
}

/** Close every Sandbox of the project; the end of a scenario. */
export async function closeSandboxes(): Promise<void> {
	const client = await lfs();
	for (const { sandbox: id } of (await client.project.list_sandboxes(100, 0)).items) {
		for (const ws of (await client.sandbox.list_workspaces(id, 100, 0)).items) {
			await client.workspace.unmount({ sandbox: ws.sandbox, path: ws.path }, true).catch(() => undefined);
		}
		await client.sandbox.close(id).catch(() => undefined);
	}
	sandbox = undefined;
}
