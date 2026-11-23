// Deterministic crash points. `CRASH_AT=<name>` makes the process exit with 137 (what a SIGKILL looks like) the first
// time it reaches `crashPoint(name)`. A marker file in the run directory makes sure the restarted process passes the
// same point without crashing again.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function crashPoint(name: string): void {
	if (process.env.CRASH_AT !== name) return;
	const marker = join(process.env.RUN_DIR ?? ".", `crashed-${name}`);
	if (existsSync(marker)) return;
	writeFileSync(marker, `${new Date().toISOString()}\n`);
	process.stdout.write(`@ ${JSON.stringify({ event: "crash", at: name })}\n`);
	process.exit(137);
}
