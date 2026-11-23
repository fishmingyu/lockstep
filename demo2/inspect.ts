// Read a run's store without running anything: the router transcript, the workers and their transcripts, and the
// live tasks. Used by the scenarios to check what happened, and by hand: RUN_DIR=runs/demo2-H node demo2/inspect.ts
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ConversationId, EntryRecord, Harness } from "@earendil-works/pi-durable";
import { textOf } from "../shared/script.ts";
import { openLockstep } from "./harness.ts";
import { Workers } from "./router.ts";

export type Step =
	| { kind: "input"; text: string }
	| { kind: "call"; tool: string; args: Record<string, unknown> }
	| { kind: "result"; tool: string; isError: boolean; text: string; exitCode?: number }
	| { kind: "answer"; text: string };

export type RunState = {
	router: Step[];
	workers: Record<string, { conversationId: ConversationId; where: string; steps: Step[]; testExit: number | undefined }>;
	conversations: number;
	liveTasks: string[];
};

function steps(entries: readonly EntryRecord[]): Step[] {
	const out: Step[] = [];
	for (const entry of entries) {
		const message = entry.model?.[0];
		if (message === undefined) continue;
		if (message.role === "user") out.push({ kind: "input", text: textOf(message) });
		if (message.role === "toolResult") {
			const exitCode = (message.details as { exitCode?: unknown } | undefined)?.exitCode;
			out.push({
				kind: "result",
				tool: message.toolName,
				isError: message.isError,
				text: textOf(message).trim(),
				...(typeof exitCode === "number" ? { exitCode } : {}),
			});
		}
		if (message.role === "assistant") {
			for (const part of (message as AssistantMessage).content) {
				if (part.type === "toolCall") out.push({ kind: "call", tool: part.name, args: part.arguments });
				if (part.type === "text" && part.text !== "") out.push({ kind: "answer", text: part.text });
			}
		}
	}
	return out;
}

async function transcript(harness: Harness, id: ConversationId, context: Context): Promise<EntryRecord[]> {
	const conversation = (await harness.conversation(id, context))!;
	const page = await conversation.entries({ order: "ascending" }, 1000, undefined, context);
	return [...page.items];
}

export async function inspectRun(runDir: string, context: Context = BACKGROUND_CONTEXT): Promise<RunState> {
	const { harness, root } = await openLockstep(runDir, context, { readOnly: true });
	try {
		const workers: RunState["workers"] = {};
		for (const [name, worker] of Object.entries((await harness.snapshot(Workers, root.id, context))?.workers ?? {})) {
			const entries = await transcript(harness, worker.conversationId, context);
			const bash = steps(entries).filter((step) => step.kind === "result" && step.tool === "bash" && !/was interrupted/.test(step.text));
			const last = bash.at(-1) as Extract<Step, { kind: "result" }> | undefined;
			const testExit =
				last === undefined ? undefined : (last.exitCode ?? (last.isError ? Number(/exited with code (\d+)/.exec(last.text)?.[1] ?? -1) : 0));
			workers[name] = { conversationId: worker.conversationId, where: worker.where, steps: steps(entries), testExit };
		}
		const liveTasks = (await harness.inspect(context)).tasks.map((task) => JSON.stringify(task).slice(0, 300));
		return { router: steps(await transcript(harness, root.id, context)), workers, conversations: countConversations(runDir), liveTasks };
	} finally {
		await harness.close(context);
	}
}

/** Counted straight from the SQLite file, independent of what the app recorded in its docs. */
function countConversations(runDir: string): number {
	const db = new DatabaseSync(join(runDir, "session.sqlite"), { readOnly: true });
	try {
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
		const table = tables.find((t) => /^conversations?$/.test(t.name))?.name;
		if (table === undefined) return -1;
		return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
	} finally {
		db.close();
	}
}

if (import.meta.main) {
	const state = await inspectRun(process.env.RUN_DIR ?? "runs/manual");
	console.log(JSON.stringify(state, null, 2));
}
