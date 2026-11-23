// Console output for the scenarios: host events as they stream in, checks, and a closing summary table. Everything
// printed is also recorded, and summary() writes one trace per scenario to runs/traces/<name>.json; the site
// (scripts/bake-traces.ts) bakes those traces into its lessons.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// LOCKSTEP_COLOR: a driver in a client container (shared/container.ts) prints to the terminal of the one that started it.
const tty = process.stdout.isTTY || process.env.LOCKSTEP_COLOR === "1";
const paint = (code: number) => (text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = paint(1);
export const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);

/** One recorded line of a scenario; `t` is milliseconds since the scenario started. */
export type TraceEntry =
	| { t: number; kind: "host"; run: string; event: Record<string, unknown> }
	| { t: number; kind: "driver" | "note"; text: string }
	| { t: number; kind: "check"; label: string; ok: boolean; detail?: unknown };

type Row = {
	scenario: string;
	title: string;
	expected: string;
	passed: boolean;
	failures: string[];
	started: number;
	trace: TraceEntry[];
	facts: Record<string, unknown>;
	/** Run by another process, which wrote its trace; see adopt(). */
	adopted?: true;
};
const rows: Row[] = [];
let current: Row | undefined;

type Untimed<T> = T extends unknown ? Omit<T, "t"> : never;
function record(entry: Untimed<TraceEntry>): void {
	if (current !== undefined) current.trace.push({ t: Date.now() - current.started, ...entry });
}

export function scenario(name: string, title: string, expected: string): void {
	current = { scenario: name, title, expected, passed: true, failures: [], started: Date.now(), trace: [], facts: {} };
	rows.push(current);
	console.log(`\n${bold(cyan(`━━ ${name}: ${title}`))}`);
	console.log(dim(`   expected: ${expected}`));
}

export function note(text: string): void {
	record({ kind: "note", text });
	console.log(`   ${text}`);
}

/** A named value the site shows in the lesson text (a line count, a tree hash). Recorded only, not printed. */
export function fact(key: string, value: unknown): void {
	if (current !== undefined) current.facts[key] = value;
}

export function check(label: string, ok: boolean, detail?: unknown): boolean {
	const suffix = detail === undefined ? "" : dim(`  (${typeof detail === "string" ? detail : JSON.stringify(detail)})`);
	record({ kind: "check", label, ok, ...(detail === undefined ? {} : { detail }) });
	console.log(`   ${ok ? green("✓") : red("✗")} ${label}${suffix}`);
	if (!ok && current !== undefined) {
		current.passed = false;
		current.failures.push(label);
	}
	return ok;
}

const short = (value: unknown, max = 90) => {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const line = text.replaceAll("\n", " ⏎ ");
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** One line per host event, prefixed with the process it came from. */
export function hostEvent(run: string, event: Record<string, unknown>): void {
	record({ kind: "host", run, event });
	const tag = dim(`[${run}]`);
	switch (event.event) {
		case "open":
			return console.log(`   ${tag} ${dim(`host up (pid ${event.pid})`)}`);
		case "intake":
			return console.log(
				`   ${tag} intake event ${event.id}: ${event.rejected === undefined ? `submission ${event.submission}` : yellow(`rejected, ${event.rejected}`)}`,
			);
		case "call":
			return console.log(`   ${tag} ${event.who} → ${bold(String(event.tool))} ${dim(short(event.args, 70))}`);
		case "result":
			return console.log(`   ${tag} ${event.who} ← ${event.tool}${event.isError ? red(" error") : ""}: ${dim(short(event.text))}`);
		case "answer":
			return console.log(`   ${tag} ${event.who}: ${short(event.text)}`);
		case "signal":
			return console.log(`   ${tag} ${yellow(`signal ${event.id} allow=${event.allow} → ${event.result}`)}`);
		case "crash":
			return console.log(`   ${tag} ${red(`crash point ${event.at}: exit 137`)}`);
		case "settled":
			return console.log(`   ${tag} submission ${event.submission} settled: ${event.status}`);
		case "exit":
			return console.log(`   ${tag} ${dim("host exits cleanly")}`);
		case "forked":
			return console.log(`   ${tag} forked at entry ${event.at}: conversation ${event.conversation}, branch ${event.branch}`);
		default:
			return console.log(`   ${tag} ${short(event)}`);
	}
}

export function driverEvent(text: string): void {
	record({ kind: "driver", text });
	console.log(`   ${yellow("▸")} ${text}`);
}

export const TRACES = resolve(import.meta.dirname, "../runs/traces");

/**
 * Take a scenario that another process ran (a driver in a client container) into this summary, from the trace it
 * wrote. No trace means it died before its summary: a failure.
 */
export function adopt(name: string, title: string, why?: string): void {
	const file = join(TRACES, `${name}.json`);
	if (why === undefined && existsSync(file)) {
		rows.push({ ...(JSON.parse(readFileSync(file, "utf8")) as Row), started: 0, adopted: true });
		return;
	}
	const failure = why ?? "the scenario's process ended without writing its trace";
	rows.push({ scenario: name, title, expected: title, passed: false, failures: [failure], started: Date.now(), trace: [], facts: {}, adopted: true });
}

/** Print the summary table and write each scenario's trace; returns whether every scenario passed. */
export function summary(): boolean {
	mkdirSync(TRACES, { recursive: true });
	for (const { started, adopted, ...row } of rows) {
		if (adopted) continue;
		const trace = { ...row, recordedAt: new Date(started).toISOString(), node: process.version };
		writeFileSync(join(TRACES, `${row.scenario}.json`), `${JSON.stringify(trace, null, "\t")}\n`);
	}
	// A driver in a client container leaves the table to the process that started it.
	if (process.env.LOCKSTEP_INNER === "1") return rows.every((row) => row.passed);
	console.log(`\n${bold("Summary")}`);
	const width = Math.max(...rows.map((row) => row.expected.length), 8);
	for (const row of rows) {
		const status = row.passed ? green("PASS") : red("FAIL");
		console.log(`   ${bold(row.scenario)}  ${status}  ${row.expected.padEnd(width)}`);
		for (const failure of row.failures) console.log(`         ${red(`✗ ${failure}`)}`);
	}
	return rows.every((row) => row.passed);
}
