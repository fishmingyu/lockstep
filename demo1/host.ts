// The Demo 1 host process: one coder conversation on either the baseline tools (VARIANT=baseline) or the LayerFS
// tools (VARIANT=lfs). With FORK_AT=<entry id> it instead forks the finished conversation at that entry, with its own
// branch, and sends the fork "[alt]" so it takes a different third step.
import { join } from "node:path";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	type ConversationInit,
	createRegistry,
	type EntryId,
	type Extension,
	Harness,
	type HarnessOptions,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { follow, log } from "../shared/follow.ts";
import { scriptedModel } from "../shared/script.ts";

export type Setup = {
	extension: Extension;
	env?: HarnessOptions["env"];
	/** Runs in the commit that creates the root conversation. */
	init?: ConversationInit;
	fork?: (harness: Harness, entry: EntryId, context: Context) => Promise<void>;
	close?: () => Promise<void>;
};

const context = BACKGROUND_CONTEXT;
const runDir = process.env.RUN_DIR;
if (runDir === undefined) throw new Error("RUN_DIR is not set");
const variant = process.env.VARIANT === "baseline" ? "baseline" : "lfs";
const setup: Setup =
	variant === "baseline"
		? (await import("./baseline.ts")).baseline(runDir)
		: await (await import("./tools.ts")).layerfsSetup(runDir, context);

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses(Array.from({ length: 1000 }, () => scriptedModel));
const registry = createRegistry();
registry.install(setup.extension);
const harness = await Harness.open(
	await openNodeSqliteStorage(join(runDir, "session.sqlite")),
	{ models, registry, ...(setup.env === undefined ? {} : { env: setup.env }) },
	context,
);
const root = await harness.root(context, {
	agent: { model: { provider: "faux", modelId: "faux-1" } },
	...(setup.init === undefined ? {} : { init: setup.init }),
});
log({ event: "open", pid: process.pid, variant });
await follow(harness, root.id, "coder", context);
harness.resume();

if (process.env.FORK_AT !== undefined) {
	await setup.fork!(harness, Number(process.env.FORK_AT) as EntryId, context);
} else {
	const content = "[coder] Write a.txt, build b.txt line by line, then bump a.txt.";
	const submission = await root.submit({ type: "input", content, requestId: "task:1" }, context);
	log({ event: "settled", submission: submission.id, status: (await submission.wait(context)).status });
}
await harness.waitForIdle(context);
await harness.close(context);
await setup.close?.();
log({ event: "exit" });
