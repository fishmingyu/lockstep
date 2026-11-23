// The bridge from answers to signals. One process writes a SQLite store, so approve.ts never signals; it writes an
// answer file. The host scans answered/ at start and while it runs, signals each answer once, and moves the file to
// done/. A crash between the signal and the move signals again on restart, which answers `duplicate`: the first value
// stands, so that is a success too.
import { mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import { crashPoint } from "../shared/crash.ts";
import { Approval } from "./policy.ts";

export type Answer = { id: string; taskId: number; key: string; allow: boolean };

export function approvalDirs(approvalsDir: string) {
	const dirs = {
		pending: join(approvalsDir, "pending"),
		answered: join(approvalsDir, "answered"),
		done: join(approvalsDir, "done"),
	};
	for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
	return dirs;
}

export function startApprovals(
	harness: Harness,
	approvalsDir: string,
	context: Context,
	log: (event: Record<string, unknown>) => void,
): { stop(): Promise<void> } {
	const dirs = approvalDirs(approvalsDir);
	let stopped = false;
	const scan = async () => {
		for (const file of readdirSync(dirs.answered).filter((name) => name.endsWith(".json")).sort()) {
			const answer = JSON.parse(readFileSync(join(dirs.answered, file), "utf8")) as Answer;
			const result = await harness.signal(answer.taskId as TaskId, Approval, answer.key, { allow: answer.allow }, context);
			log({ event: "signal", id: answer.id, allow: answer.allow, result });
			crashPoint("after-signal");
			renameSync(join(dirs.answered, file), join(dirs.done, file));
		}
	};
	const loop = (async () => {
		while (!stopped) {
			await scan();
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	})();
	return {
		async stop() {
			stopped = true;
			await loop;
		},
	};
}
