// Where the workers work, and how one lands. Two kinds, chosen by LOCKSTEP_WORKSPACES:
//
//   lfs (default): each worker gets a LayerFS Branch forked from main and Demo 1's tools (demo1/tools.ts), so its
//        file changes follow the commit protocol; land merges the worker's Branch with main and publishes the merge.
//   dir: each worker gets a copy of the main directory and Pi's CodingTools; land is rsync. Needs no LayerFS: the
//        control group, as Demo 1's scenario A is.
//
// Every step is safe to run again: a rerun after a crash finds the Branch, copy or merge the first run made.
import { execFile } from "node:child_process";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, Extension, ToolExecutionApi, Tx } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { Branch } from "../demo1/branch-doc.ts";
import { LayerfsTools } from "../demo1/tools.ts";
import { crashPoint } from "../shared/crash.ts";
import * as layerfs from "../shared/lfs.ts";
import { Workdir } from "./workdir-doc.ts";

export type Kind = "lfs" | "dir";
export const KIND: Kind = process.env.LOCKSTEP_WORKSPACES === "dir" ? "dir" : "lfs";

export type Workspaces = {
	/** The tools workers (and the router) get. */
	readonly tools: Extension;
	/** Make worker `name`'s workspace, once: a Branch name or a directory. */
	prepare(api: ToolExecutionApi, name: string, context: Context): Promise<string>;
	/** Point conversation `id` at its workspace, in the commit that creates it. */
	assign(tx: Tx, id: ConversationId, where: string): Promise<void>;
	/** Make main what the worker's workspace is; returns the paths that changed. */
	land(api: ToolExecutionApi, where: string, context: Context): Promise<string[]>;
};

const run = promisify(execFile);

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

/** Copy `from` to `to` once. The copy goes to a temporary name first, so a crash never leaves a half copy at `to`. */
async function copyOnce(from: string, to: string): Promise<void> {
	if (await exists(to)) return;
	const partial = `${to}.partial-${process.pid}`;
	await rm(partial, { recursive: true, force: true });
	await mkdir(dirname(to), { recursive: true });
	await cp(from, partial, { recursive: true, preserveTimestamps: true });
	await rename(partial, to);
}

async function mainDir(api: ToolExecutionApi, context: Context): Promise<string> {
	const path = (await api.snapshot(Workdir, api.conversationId, context))?.path;
	if (path === undefined) throw new Error("The router has no working directory");
	return path;
}

const directories: Workspaces = {
	tools: CodingTools,
	async prepare(api, name, context) {
		const main = await mainDir(api, context);
		const dir = join(dirname(main), "workers", name);
		await copyOnce(main, dir);
		return dir;
	},
	async assign(tx, id, where) {
		(await tx.doc(Workdir, id)).path = where;
	},
	// rsync --delete makes the main directory equal to the worker's, so running it again changes nothing. --checksum
	// compares contents, so only files the worker changed are reported.
	async land(api, where, context) {
		const main = await mainDir(api, context);
		const { stdout } = await run("rsync", ["-a", "--delete", "--checksum", "--itemize-changes", `${where}/`, `${main}/`]);
		return stdout
			.split("\n")
			.filter((line) => /^[<>ch*]/.test(line))
			.map((line) => line.slice(line.indexOf(" ") + 1));
	},
};

const changedPaths = (a: Record<string, string>, b: Record<string, string>) =>
	[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((path) => a[path] !== b[path]).sort();

const branches: Workspaces = {
	tools: LayerfsTools,
	// The name is fixed by the call (its task ID) and the worker: a rerun forks nothing new.
	async prepare(api, name) {
		const branch = `worker-${name}-${api.taskId}`;
		await layerfs.forkOnce(branch, "main");
		return branch;
	},
	async assign(tx, id, where) {
		(await tx.doc(Branch, id)).name = where;
	},
	// main changes only by publish, and publishing a Branch forked before main last moved would drop what main gained
	// since: so merge the worker's Branch with main into `land-<branch>` first, then publish that. A rerun finds the
	// merge Branch (NameTaken) and publishes it again, which is UpToDate once it has landed.
	async land(_api, where) {
		const client = await layerfs.lfs();
		const changed = changedPaths(await layerfs.readTree("main"), await layerfs.readTree(where));
		const name = `land-${where}`;
		try {
			await client.branch.merge(where, "main", name, `land ${where}`);
		} catch (error) {
			if (!layerfs.isRefusal(error, "NameTaken")) throw error;
		}
		crashPoint("after-merge");
		await client.branch.publish(name);
		return changed;
	},
};

export const workspaces: Workspaces = KIND === "lfs" ? branches : directories;
