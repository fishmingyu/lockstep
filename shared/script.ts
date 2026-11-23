// Scripted ("faux") models. One factory answers every conversation: it reads the tag in the conversation's first user
// message ([router], [worker:a], ...) and decides the next step from the tool results already in the transcript. The
// decision depends only on the transcript, so a restarted process makes the same decision again.
import type { AssistantMessage, FauxResponseFactory, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

export function textOf(message: Message | undefined): string {
	if (message === undefined) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): AssistantMessage =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = (text: string): AssistantMessage => fauxAssistantMessage([fauxText(text)]);

/** The tag of the conversation: the bracketed prefix of its first user message. */
function tagOf(messages: readonly Message[]): string {
	const first = messages.find((message) => message.role === "user");
	return /^\[([^\]]+)\]/.exec(textOf(first))?.[1] ?? "";
}

const isInterrupted = (result: ToolResultMessage | undefined) =>
	result !== undefined && result.isError && /interrupted/i.test(textOf(result));

// ─── Demo 2: router and workers ─────────────────────────────────────────────

/**
 * A worker's check: regenerate slugs.txt with its fix (gen_slugs.py, a slow build step that writes a file, about 3 s),
 * then run the tests. The exit code is the tests'.
 */
export const TEST_COMMAND = "export PYTHONDONTWRITEBYTECODE=1; python3 gen_slugs.py && python3 -m pytest -q -p no:cacheprovider";

export const FIX_A = `import re


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
`;

// Drops punctuation but keeps runs of spaces: "  many   spaces " becomes "--many---spaces-".
const FIX_B = `def slugify(title: str) -> str:
    kept = "".join(c for c in title.lower() if c.isalnum() or c == " ")
    return kept.replace(" ", "-")
`;

function router(messages: readonly Message[]): AssistantMessage {
	const results = messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
	switch (results.length) {
		case 0:
			return call("spawn_worker", { name: "a", task: "Fix slugify() in fix.py with a regex, then run the tests." });
		case 1:
			return call("spawn_worker", { name: "b", task: "Fix slugify() in fix.py by filtering characters, then run the tests." });
		case 2:
			return call("wait_workers", {});
		case 3: {
			// wait_workers reports one line per worker: "a: done, tests exit 0".
			const passing = /^(\w+):.*tests exit 0$/m.exec(textOf(results[2]))?.[1];
			return passing === undefined ? say("No worker passed the tests; nothing to land.") : call("land", { name: passing });
		}
		default: {
			const land = results[3]!;
			return land.isError ? say(`Did not land: ${textOf(land)}`) : say(`Landed: ${textOf(land)}`);
		}
	}
}

function worker(name: string, messages: readonly Message[]): AssistantMessage {
	const results = messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
	const last = results.at(-1);
	if (last === undefined) return call("write", { path: "fix.py", content: name === "a" ? FIX_A : FIX_B });
	if (last.toolName === "write") return call("bash", { command: TEST_COMMAND });
	// A real model told that its test run was cut off by a restart would run the tests again; so does this one.
	if (last.toolName === "bash" && isInterrupted(last)) return call("bash", { command: TEST_COMMAND });
	const tally = /\d+ (?:failed|passed)[^\n=]*/.exec(textOf(last))?.[0]?.trim() ?? "no tally";
	return say(last.isError ? `Tests failed (${tally}).` : `Tests pass (${tally}).`);
}

// ─── Demo 1: one coder, four steps ──────────────────────────────────────────

/** Ten appends half a second apart: a long command with a file side effect, to be killed halfway. */
export const LOOP_COMMAND = 'for i in $(seq 1 10); do echo "line $i" >> b.txt; sleep 0.5; done';

function coder(messages: readonly Message[]): AssistantMessage {
	const results = messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
	const last = results.at(-1);
	// A fork is sent "[alt]" and takes another third step.
	const alt = messages.some((message) => message.role === "user" && textOf(message).startsWith("[alt]"));
	if (last === undefined) return call("write", { path: "a.txt", content: "version 1\n" });
	if (last.toolName === "write") return call("bash", { command: LOOP_COMMAND });
	if (last.toolName === "bash" && isInterrupted(last)) return call("bash", { command: LOOP_COMMAND });
	if (last.toolName === "bash") {
		const newText = alt ? "version 2 (alt)" : "version 2";
		return call("edit", { path: "a.txt", edits: [{ oldText: "version 1", newText }] });
	}
	return say("Done.");
}

export const scriptedModel: FauxResponseFactory = (context) => {
	const messages = context.messages.filter((message) => message.role !== "system");
	const tag = tagOf(messages);
	if (tag === "router") return router(messages);
	if (tag.startsWith("worker:")) return worker(tag.slice("worker:".length), messages);
	if (tag === "coder") return coder(messages);
	return say(`Unknown conversation tag "${tag}".`);
};
