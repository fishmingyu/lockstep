// forkWithBranch: fork a conversation at an entry, and give the fork a LayerFS Branch forked from the files as they
// were at that entry. The files at an entry are the commit of the newest tool result at or before it (each LayerFS tool
// call reports its commit in `details.commit`); before any commit, the Branch's state when the first call began
// (`details.base`), or the Branch's fork base.
import type { Context } from "@earendil-works/chord/context";
import type { Conversation, EntryId, Harness } from "@earendil-works/pi-durable";
import * as layerfs from "../shared/lfs.ts";
import { Branch } from "./branch-doc.ts";

type FileDetails = { commit?: string | null; base?: string | null };

/** The ref holding the conversation's files as of entry `at`. */
async function filesAt(conversation: Conversation, at: EntryId, parent: string, context: Context): Promise<string> {
	const page = await conversation.entries({ order: "descending" }, 1000, undefined, context);
	let base: string | null | undefined;
	for (const entry of page.items) {
		if (entry.id > at) continue;
		const message = entry.model?.[0];
		if (message?.role !== "toolResult") continue;
		const details = (message.details ?? {}) as FileDetails;
		if (typeof details.commit === "string") return details.commit;
		if (details.base !== undefined) base = details.base;
	}
	if (typeof base === "string") return base;
	const info = await layerfs.branchInfo(parent);
	if (info === undefined) throw new Error(`No LayerFS branch ${parent}`);
	return info.base;
}

export async function forkWithBranch(harness: Harness, conversation: Conversation, at: EntryId, context: Context): Promise<Conversation> {
	const parent = (await harness.snapshot(Branch, conversation.id, context))?.name;
	if (parent === undefined) throw new Error("The conversation has no LayerFS branch");
	const from = await filesAt(conversation, at, parent, context);
	// A fixed name, so running this again after a crash finds the Branch the first run made.
	const name = `c${conversation.id}-at-${at}`;
	await layerfs.forkOnce(name, from);
	return conversation.fork(
		at,
		{
			ownership: { kind: "ownerless" },
			init: async (tx, id) => {
				(await tx.doc(Branch, id)).name = name;
			},
		},
		context,
	);
}
