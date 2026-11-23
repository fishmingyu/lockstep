// Runs a host process as a child: streams its events, lets a scenario act on them (approve, SIGKILL), and returns
// how it ended. A restart is just another runHost() on the same run directory.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { driverEvent, hostEvent } from "./report.ts";

export type HostEvent = { event: string } & Record<string, unknown>;
export type HostRun = { label: string; code: number | null; signal: NodeJS.Signals | null; events: HostEvent[]; stderr: string };

export type RunOptions = {
	label: string;
	script: string;
	runDir: string;
	env?: Record<string, string>;
	/** Called every 50 ms and on every event; may approve, kill, or wait. Returning "kill" sends SIGKILL. */
	tick?: (events: readonly HostEvent[]) => Promise<"kill" | undefined> | "kill" | undefined;
	timeoutMs?: number;
};

export async function runHost(options: RunOptions): Promise<HostRun> {
	const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", options.script], {
		env: { ...process.env, RUN_DIR: options.runDir, ...(options.env ?? {}) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const events: HostEvent[] = [];
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	createInterface({ input: child.stdout }).on("line", (line) => {
		if (!line.startsWith("@ ")) return;
		const event = JSON.parse(line.slice(2)) as HostEvent;
		events.push(event);
		hostEvent(options.label, event);
	});
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		child.on("exit", (code, signal) => resolve({ code, signal }));
	});
	let done = false;
	let busy = false;
	const timer = setInterval(async () => {
		if (done || busy || options.tick === undefined) return;
		busy = true;
		try {
			if ((await options.tick(events)) === "kill" && !done) {
				driverEvent(`SIGKILL host pid ${child.pid}`);
				child.kill("SIGKILL");
				done = true;
			}
		} finally {
			busy = false;
		}
	}, 50);
	const timeout = setTimeout(() => {
		if (done) return;
		driverEvent(`timeout after ${options.timeoutMs ?? 60_000} ms: SIGKILL`);
		child.kill("SIGKILL");
	}, options.timeoutMs ?? 60_000);
	const { code, signal } = await exited;
	done = true;
	clearInterval(timer);
	clearTimeout(timeout);
	// Let the last lines of output arrive.
	await new Promise((resolve) => setTimeout(resolve, 20));
	if (stderr.trim() !== "" && code !== 0) console.log(stderr.trim().split("\n").slice(-15).map((l) => `   ! ${l}`).join("\n"));
	return { label: options.label, code, signal, events, stderr };
}
