// The mandate, as a beforeTool gate (example 44). Rule 1: land always needs approval. Rule 2: a bash command that
// pushes or deletes recursively needs approval. A call that needs approval parks on a signal keyed by a digest of its
// arguments, with a deadline fixed at its first pass; the question goes to a file that a person answers with approve.ts.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { bool, obj } from "@earendil-works/pi-schema";
import { defineExtension, defineSignal, type Extension, hook, ToolTask } from "@earendil-works/pi-durable";

export const Approval = defineSignal({ name: "lockstep.approval", version: 1, schema: obj({ allow: bool() }) });
const DAY = 24 * 60 * 60 * 1000;

export function needsApproval(name: string, args: Record<string, unknown>): string | undefined {
	if (name === "land") return "land always needs approval";
	if (name === "bash" && /git push|rm -rf/.test(String(args.command ?? ""))) return "risky shell command";
	return undefined;
}

/** JSON with sorted keys, so equal arguments give equal digests. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}
export const digest = (name: string, args: unknown) =>
	createHash("sha256").update(canonical({ name, args })).digest("hex").slice(0, 16);

export type PendingApproval = {
	id: string;
	taskId: number;
	key: string;
	tool: string;
	arguments: Record<string, unknown>;
	reason: string;
	until: number;
};

/** Write a file atomically: a reader never sees half of it. */
export function writeJsonAtomic(path: string, value: unknown): void {
	const partial = `${path}.partial-${process.pid}`;
	writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(partial, path);
}

export function createPolicy(approvalsDir: string): Extension {
	const pending = join(approvalsDir, "pending");
	mkdirSync(pending, { recursive: true });
	return defineExtension({
		name: "lockstep-policy",
		hooks: [
			hook(ToolTask, {
				beforeTool: async (call, api, context) => {
					const reason = needsApproval(call.name, call.arguments);
					if (reason === undefined) return undefined;
					const key = digest(call.name, call.arguments);
					const id = `${api.taskId}.${key}`;
					const state = await api.readSignal(Approval, key, context);
					// One deadline per question, fixed at the first pass; every wake and every reopen keeps it.
					const until = await api.memo(`approvals.until.${key}`, api.now() + DAY, context);
					if (state === undefined) {
						// Runs again on every wake and reopen: the same file, rewritten.
						const question: PendingApproval = { id, taskId: api.taskId, key, tool: call.name, arguments: call.arguments, reason, until };
						writeJsonAtomic(join(pending, `${id}.json`), question);
						return { sleep: { signals: [Approval.key(key)], until } };
					}
					rmSync(join(pending, `${id}.json`), { force: true });
					if ("expired" in state) return { block: "No approval within a day" };
					return state.value.allow ? undefined : { block: "Not approved" };
				},
			}),
		],
	});
}
