// Opens the Harness for one run directory: SQLite storage, the scripted model, and the registry. With LayerFS
// workspaces the tools work on each conversation's Branch doc and there is no environment; with directories an
// environment function gives each conversation a NodeExecutionEnv in the directory its Workdir doc names.
import { join } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { scriptedModel } from "../shared/script.ts";
import { createPolicy } from "./policy.ts";
import { Router } from "./router.ts";
import { Workdir } from "./workdir-doc.ts";
import { KIND, workspaces } from "./workspaces.ts";

export const MODEL = { provider: "faux", modelId: "faux-1" };

export type Lockstep = { harness: Harness; root: Conversation };

export async function openLockstep(runDir: string, context: Context, options: { readOnly?: boolean } = {}): Promise<Lockstep> {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	// Each request takes the next step; every step is the same function of the transcript.
	faux.setResponses(Array.from({ length: 1000 }, () => scriptedModel));

	const registry = createRegistry();
	registry.install(workspaces.tools);
	registry.install(Router);
	registry.install(createPolicy(join(runDir, "approvals")));

	const harness = await Harness.open(
		await openNodeSqliteStorage(join(runDir, "session.sqlite")),
		{
			models,
			registry,
			readOnly: options.readOnly === true,
			// Committed reads only. A conversation without a directory gets no environment, so its tools fail cleanly.
			...(KIND === "lfs"
				? {}
				: {
						env: async ({ conversationId, read }, envContext) => {
							const workdir = await read.snapshot(Workdir, conversationId, envContext);
							return workdir?.path === undefined ? undefined : new NodeExecutionEnv({ cwd: workdir.path });
						},
					}),
		},
		context,
	);
	const root = options.readOnly
		? await harness.root(context)
		: await harness.root(context, {
				agent: { model: MODEL },
				// The router lands into main: with LayerFS that is the project's main, with directories `main/`.
				...(KIND === "lfs"
					? {}
					: {
							init: async (tx, id) => {
								(await tx.doc(Workdir, id)).path = join(runDir, "main");
							},
						}),
			});
	return { harness, root };
}
