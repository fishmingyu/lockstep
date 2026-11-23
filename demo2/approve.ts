// approve <id> yes|no: answer a pending approval. Only writes a file; the host process delivers it.
// Without arguments, lists what is pending. The run directory comes from RUN_DIR (default runs/manual).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { approvalDirs, type Answer } from "./approvals.ts";
import { type PendingApproval, writeJsonAtomic } from "./policy.ts";

const dirs = approvalDirs(join(process.env.RUN_DIR ?? "runs/manual", "approvals"));
const [id, decision] = process.argv.slice(2);

if (id === undefined) {
	const pending = readdirSync(dirs.pending).filter((name) => name.endsWith(".json"));
	if (pending.length === 0) console.log("nothing pending");
	for (const file of pending) {
		const question = JSON.parse(readFileSync(join(dirs.pending, file), "utf8")) as PendingApproval;
		console.log(`${question.id}  ${question.tool} ${JSON.stringify(question.arguments)}  (${question.reason})`);
	}
	process.exit(0);
}
if (decision !== "yes" && decision !== "no") {
	console.error("usage: approve <id> yes|no");
	process.exit(2);
}
const path = join(dirs.pending, `${id}.json`);
if (!existsSync(path)) {
	console.error(`no pending approval ${id}`);
	process.exit(1);
}
const question = JSON.parse(readFileSync(path, "utf8")) as PendingApproval;
const answer: Answer = { id, taskId: question.taskId, key: question.key, allow: decision === "yes" };
writeJsonAtomic(join(dirs.answered, `${id}.json`), answer);
console.log(`answered ${id}: ${decision}`);
