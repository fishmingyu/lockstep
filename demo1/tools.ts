// The LayerFS tools: read, write, edit and bash on the conversation's Branch (its Branch doc), through the SDK. All four
// are replay-safe: after a crash the Harness runs an unfinished call again, and the commit protocol makes the rerun
// end where one run would. A call's commit carries its task ID (`pi-task:<taskId>`), so a rerun can tell whether the
// first run got that far:
//
//   1. memo the Branch head on the first run (a rerun reads the same value back)
//   2. a commit since then with this task ID: the call finished, return its result from the commit
//   3. otherwise discard what a killed run left on the Branch (a mounted Workspace, its orphaned command), and run
//
// There is no ExecutionEnv: Workspaces live inside the Sandbox container at /workspaces/<n>, which the host cannot see.
import type { Context } from "@earendil-works/chord/context";
import { arr, obj, opt, int, str } from "@earendil-works/pi-schema";
import { defineExtension, defineTool, type Extension, type ToolExecutionApi } from "@earendil-works/pi-durable";
import type { Change } from "@layerfs/agent";
import { crashPoint } from "../shared/crash.ts";
import { follow, log } from "../shared/follow.ts";
import * as layerfs from "../shared/lfs.ts";
import { Branch } from "./branch-doc.ts";
import { forkWithBranch } from "./fork.ts";
import type { Setup } from "./host.ts";

const text = (value: string) => [{ type: "text" as const, text: value }];
const absolute = (path: string) => `/${path.replace(/^\/+/, "")}`;

export async function branchOf(api: Pick<ToolExecutionApi, "snapshot" | "conversationId">, context: Context): Promise<string> {
	const name = (await api.snapshot(Branch, api.conversationId, context))?.name;
	if (name === undefined) throw new Error("This conversation has no LayerFS branch");
	return name;
}

/** Steps 1 and 2 of the protocol. */
async function begin(api: ToolExecutionApi, context: Context) {
	const branch = await branchOf(api, context);
	const base = await api.memo<string | null>("lfs.base", await layerfs.head(branch), context);
	const done = await layerfs.findTaskCommit(branch, base, api.taskId);
	return { branch, base, done };
}

/** One commit of `changes`, unless an earlier run of this call made it. */
async function change(api: ToolExecutionApi, context: Context, what: string, changes: Change[]) {
	const { branch, base, done } = await begin(api, context);
	let commit = done?.id;
	if (done === undefined) {
		await layerfs.discardLeftovers(branch);
		const saved = await (await layerfs.lfs()).fs.apply(branch, changes, `pi-task:${api.taskId}\n${what}`);
		commit = saved.head;
	}
	return { branch, base, commit: commit ?? null, replayed: done !== undefined };
}

const read = defineTool({
	name: "read",
	description: "Read a file of the working branch.",
	parameters: obj({ path: str(), offset: opt(int()), limit: opt(int()) }),
	replay: "safe",
	execute: async ({ path, offset, limit }, api, context) => {
		const branch = await branchOf(api, context);
		const start = offset ?? 1;
		const window = await (await layerfs.lfs()).fs.read(branch, absolute(path), start, start + (limit ?? 2000) - 1);
		return { output: text(window.text), details: { branch } };
	},
});

const write = defineTool({
	name: "write",
	description: "Write a file on the working branch (one commit).",
	parameters: obj({ path: str(), content: str() }),
	replay: "safe",
	execute: async ({ path, content }, api, context) => {
		const file = absolute(path);
		const dir = file.slice(0, file.lastIndexOf("/"));
		const changes: Change[] = [...(dir === "" ? [] : [{ op: "mkdir" as const, path: dir }]), { op: "write", path: file, content }];
		const details = await change(api, context, `write ${file}`, changes);
		return { output: text(`Successfully wrote ${Buffer.byteLength(content)} bytes to ${path}`), details };
	},
});

const edit = defineTool({
	name: "edit",
	description: "Replace exact text in a file of the working branch (one commit).",
	parameters: obj({ path: str(), edits: arr(obj({ oldText: str(), newText: str() })) }),
	replay: "safe",
	execute: async ({ path, edits }, api, context) => {
		const file = absolute(path);
		const changes: Change[] = edits.map((e) => ({ op: "edit", path: file, oldText: e.oldText, newText: e.newText }));
		const details = await change(api, context, `edit ${file}`, changes);
		return { output: text(`Successfully replaced ${edits.length} block(s) in ${path}.`), details };
	},
});

const exited = (exitCode: number) =>
	exitCode === 0 ? {} : { isError: true, diagnostics: [{ severity: "error" as const, code: "exit_code", message: `Command exited with code ${exitCode}` }] };

const bash = defineTool({
	name: "bash",
	description: "Run a bash command in a Workspace of the working branch; what it changes is committed, also when it fails.",
	parameters: obj({ command: str() }),
	replay: "safe",
	execute: async ({ command }, api, context) => {
		const { branch, base, done } = await begin(api, context);
		if (done !== undefined) {
			// The first run committed and then died: the result is in the commit. A Workspace it left mounted (committed,
			// so clean) is unmounted.
			await layerfs.discardLeftovers(branch);
			const { exitCode, output } = layerfs.parseTaskMessage(done.message);
			return { output: text(output), details: { branch, base, commit: done.id, exitCode, replayed: true }, ...exited(exitCode) };
		}
		const discarded = await layerfs.discardLeftovers(branch);
		const client = await layerfs.lfs();
		const ws = await layerfs.mount(branch);
		const run = await client.workspace.exec(ws, command, `pi-task:${api.taskId}`);
		crashPoint("after-exec");
		// A command that fails is committed too: what it changed is part of what the model sees next.
		const saved = await client.workspace.commit(ws, layerfs.taskMessage(api.taskId, run.exitCode, run.stdout + run.stderr));
		crashPoint("after-commit");
		await client.workspace.unmount(ws);
		const details = {
			branch,
			base,
			// A command that changed nothing makes no commit; a rerun then runs it again, harmlessly.
			commit: saved.kind === "Committed" ? saved.head : null,
			exitCode: run.exitCode,
			discarded,
		};
		return { output: text(run.stdout + run.stderr), details, ...exited(run.exitCode) };
	},
});

export const LayerfsTools: Extension = defineExtension({ name: "lockstep-layerfs-tools", tools: [read, write, edit, bash] });

/** Demo 1's host on LayerFS: the coder works on Branch LFS_BRANCH (default `coder`), forked from main. */
export async function layerfsSetup(_runDir: string, _context: Context): Promise<Setup> {
	const branch = process.env.LFS_BRANCH ?? "coder";
	await layerfs.forkOnce(branch);
	return {
		extension: LayerfsTools,
		init: async (tx, id) => {
			(await tx.doc(Branch, id)).name = branch;
		},
		fork: async (harness, entry, context) => {
			const root = await harness.root(context);
			const fork = await forkWithBranch(harness, root, entry, context);
			log({ event: "forked", at: entry, conversation: fork.id, branch: (await harness.snapshot(Branch, fork.id, context))?.name });
			await follow(harness, fork.id, "fork", context);
			const content = "[alt] Take a different third step.";
			const submission = await fork.submit({ type: "input", content, requestId: `fork:${entry}` }, context);
			log({ event: "settled", submission: submission.id, status: (await submission.wait(context)).status });
		},
		close: () => layerfs.closeLfs(),
	};
}
