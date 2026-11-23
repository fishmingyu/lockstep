// The router's tools: spawn_worker, wait_workers, land. Workers are child conversations of the router, each with its
// own workspace (workspaces.ts: a LayerFS Branch forked from main, or a copy of the main directory). Everything a rerun
// needs is in the Workers doc, written in the same commit that creates the worker, so a crash at any point leaves
// either no worker or one fully recorded worker.
import type { Context } from "@earendil-works/chord/context";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { obj, str } from "@earendil-works/pi-schema";
import {
	type ConversationId,
	configure,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	type Extension,
	type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { crashPoint } from "../shared/crash.ts";
import { textOf } from "../shared/script.ts";
import { workspaces } from "./workspaces.ts";

export type WorkerRecord = {
	conversationId: ConversationId;
	/** Its workspace: a Branch name, or a directory. */
	where: string;
	task: string;
	/** The submission's request ID, fixed when the worker is created, so every rerun finds the same submission. */
	requestId: string;
};

/** The router conversation's workers, by name. */
export const Workers = defineDoc<{ workers: Record<string, WorkerRecord> }>({
	checkpointWhen: () => false,
	kind: "lockstep.workers",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ workers: {} }),
});

// A worker must outlive the spawn_worker call that creates it, so the two workers run side by side. A conversation
// owned by the call would hold the call open until the worker finishes. As in example 22, an anchor owns it instead:
// a background task of the router conversation that finishes at once.
const Anchor = defineTask<null, { phase: "done" }, null>({
	name: "lockstep.worker-anchor",
	version: 1,
	initial: () => ({ phase: "done" }),
	phases: {
		done: (_anchor, runtime, context) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context),
	},
	abort: (_anchor, runtime, context) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

const text = (value: string) => [{ type: "text" as const, text: value }];

async function workers(api: ToolExecutionApi, context: Context): Promise<Record<string, WorkerRecord>> {
	return (await api.snapshot(Workers, api.conversationId, context))?.workers ?? {};
}

const workerInput = (name: string, worker: WorkerRecord) =>
	({ type: "input", content: `[worker:${name}] ${worker.task}`, requestId: worker.requestId }) as const;

/** The exit code of the worker's last test run that finished, from its transcript. */
export async function lastTestExit(
	api: Pick<ToolExecutionApi, "commit">,
	conversationId: ConversationId,
	context: Context,
): Promise<number | undefined> {
	const page = await api.commit((tx) => tx.scanEntries({ conversationId, order: "descending" }, 200), context);
	for (const entry of page.items) {
		const message = entry.model?.[0];
		if (message?.role !== "toolResult" || message.toolName !== "bash") continue;
		const result = message as ToolResultMessage;
		const body = textOf(result);
		if (/was interrupted/.test(body)) continue;
		// The LayerFS bash reports its exit code in its details; CodingTools' in its error text.
		const reported = (result.details as { exitCode?: unknown } | undefined)?.exitCode;
		if (typeof reported === "number") return reported;
		if (!result.isError) return 0;
		const code = /exited with code (\d+)/.exec(`${body}\n${JSON.stringify(entry.data ?? null)}`)?.[1];
		return code === undefined ? -1 : Number(code);
	}
	return undefined;
}

const spawnWorker = defineTool({
	name: "spawn_worker",
	description: "Start a worker agent in its own workspace (a branch of the repository). Returns at once; use wait_workers.",
	parameters: obj({ name: str(), task: str() }),
	// A rerun finds the worker in the Workers doc and the submission by its request ID: nothing is dispatched twice.
	replay: "safe",
	execute: async ({ name, task }, api, context) => {
		const where = await workspaces.prepare(api, name, context);
		const worker = await api.commit(async (tx) => {
			const state = await tx.doc(Workers, api.conversationId);
			const existing = Object.hasOwn(state.workers, name) ? state.workers[name] : undefined;
			if (existing !== undefined) return { ...existing };
			const anchor = await tx.createTask(Anchor, null, { ownership: { kind: "conversation" }, background: true });
			const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
			// A worker cannot spawn workers or land: without the router extension it is not offered those tools.
			await configure(tx, child.id, { extensions: { remove: [Router] } });
			await workspaces.assign(tx, child.id, where);
			const created: WorkerRecord = { conversationId: child.id, where, task, requestId: `spawn:${api.taskId}:${name}` };
			state.workers[name] = created;
			return { ...created };
		}, context);
		const handle = (await api.conversation(worker.conversationId, context))!;
		const submission = await handle.submit(workerInput(name, worker), context);
		crashPoint(`after-spawn-${name}`);
		return {
			output: text(`Started worker ${name} in ${worker.where}.`),
			details: { name, conversationId: worker.conversationId, submissionId: submission.id },
		};
	},
});

const waitWorkers = defineTool({
	name: "wait_workers",
	description: "Wait until every worker has answered. Reports each worker's last test exit code.",
	parameters: obj({}),
	replay: "safe",
	execute: async (_args, api, context) => {
		const lines: string[] = [];
		const results: Record<string, { status: string; exitCode: number | null }> = {};
		for (const [name, worker] of Object.entries(await workers(api, context))) {
			const handle = (await api.conversation(worker.conversationId, context))!;
			// The same request ID returns the submission spawn_worker made; this only waits for it.
			const settled = await (await handle.submit(workerInput(name, worker), context)).wait(context);
			const exitCode = (await lastTestExit(api, worker.conversationId, context)) ?? null;
			results[name] = { status: settled.status, exitCode };
			lines.push(`${name}: ${settled.status}, tests exit ${exitCode ?? "none"}`);
		}
		return { output: text(lines.join("\n")), details: results };
	},
});

const land = defineTool({
	name: "land",
	description: "Merge one worker's work into main. Needs approval.",
	parameters: obj({ name: str() }),
	// Landing again lands nothing new (workspaces.ts), so a rerun after a crash is safe.
	replay: "safe",
	execute: async ({ name }, api, context) => {
		const worker = (await workers(api, context))[name];
		if (worker === undefined) throw new Error(`No worker named ${name}`);
		const changed = await workspaces.land(api, worker.where, context);
		return {
			output: text(`worker ${name} -> main (${changed.length === 0 ? "no changes" : changed.join(", ")})`),
			details: { name, changed },
		};
	},
});

export const Router: Extension = defineExtension({
	name: "lockstep-router",
	tasks: [Anchor],
	tools: [spawnWorker, waitWorkers, land],
});
