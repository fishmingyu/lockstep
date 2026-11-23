// The superagent host process: open the Harness, deliver approvals, take in the run's events, and exit once every
// admitted event's run has settled. A restart runs the same program: intake finds the submissions the last process
// made, and the Harness resumes what it left unfinished. The driver starts, kills, and restarts this process.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { ConversationId, Harness, Submission } from "@earendil-works/pi-durable";
import { follow, log } from "../shared/follow.ts";
import type { IssueEvent } from "./admission.ts";
import { startApprovals } from "./approvals.ts";
import { openLockstep } from "./harness.ts";
import { intake } from "./intake.ts";
import { Workers } from "./router.ts";
import { closeLfs } from "../shared/lfs.ts";

const context = BACKGROUND_CONTEXT;
const runDir = process.env.RUN_DIR;
if (runDir === undefined) throw new Error("RUN_DIR is not set");

const followWorkers = (harness: Harness) => async (result: ToolResultMessage) => {
	const details = result.details as { name?: string; conversationId?: ConversationId } | undefined;
	if (result.toolName === "spawn_worker" && details?.conversationId !== undefined) {
		await follow(harness, details.conversationId, `worker:${details.name}`, context);
	}
};

const { harness, root } = await openLockstep(runDir, context);
log({ event: "open", pid: process.pid, root: root.id });
await follow(harness, root.id, "router", context, followWorkers(harness));
// Workers an earlier process started.
for (const [name, worker] of Object.entries((await harness.snapshot(Workers, root.id, context))?.workers ?? {})) {
	await follow(harness, worker.conversationId, `worker:${name}`, context);
}
const approvals = startApprovals(harness, join(runDir, "approvals"), context, log);
harness.resume();

const events = JSON.parse(readFileSync(join(runDir, "events.json"), "utf8")) as IssueEvent[];
const submissions: Submission[] = [];
for (const event of events) {
	const admitted = await intake(root, event, context);
	if (admitted.admitted) {
		log({ event: "intake", id: event.id, submission: admitted.submission.id });
		submissions.push(admitted.submission);
	} else {
		log({ event: "intake", id: event.id, rejected: admitted.reason });
	}
}
for (const submission of submissions) {
	const settled = await submission.wait(context);
	log({ event: "settled", submission: submission.id, status: settled.status });
}
await harness.waitForIdle(context);
await approvals.stop();
await harness.close(context);
await closeLfs();
log({ event: "exit" });
