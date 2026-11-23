// Print a conversation's tool calls, results, and answers as `@ {...}` event lines while it runs. The driver parses
// them. Only entries committed after the watch starts are printed, so a restarted host shows only new work.
import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { textOf } from "./script.ts";

export const log = (event: Record<string, unknown>) => process.stdout.write(`@ ${JSON.stringify(event)}\n`);

const followed = new Set<ConversationId>();

export async function follow(
	harness: Harness,
	id: ConversationId,
	who: string,
	context: Context,
	onResult?: (result: ToolResultMessage) => Promise<void>,
): Promise<void> {
	if (followed.has(id)) return;
	followed.add(id);
	const watch = await (await harness.conversation(id, context))!.watch(context);
	let newest = watch.value.entries.at(-1)?.id ?? 0;
	watch.start(async (call) => {
		if (call.kind !== "value") return;
		for (const entry of call.value.entries) {
			if (entry.id <= newest) continue;
			const message = entry.model?.[0];
			if (message?.role === "assistant") {
				for (const part of (message as AssistantMessage).content) {
					if (part.type === "toolCall") log({ event: "call", who, entry: entry.id, tool: part.name, args: part.arguments });
					if (part.type === "text" && part.text !== "") log({ event: "answer", who, text: part.text });
				}
			} else if (message?.role === "toolResult") {
				const result = message as ToolResultMessage;
				log({ event: "result", who, entry: entry.id, tool: result.toolName, isError: result.isError, text: textOf(result).trim().slice(-200), details: result.details ?? null });
				await onResult?.(result);
			}
		}
		newest = call.value.entries.at(-1)?.id ?? newest;
	});
}
