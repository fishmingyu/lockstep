// Recorded runs: the traces `npm run demo1` / `npm run demo2` wrote and scripts/bake-traces.ts baked into the site.
// Lessons read facts and events from here; the Run log tab replays the entries.
import { TRACES } from "../data/traces.js";

export { TRACES };

/** A recorded value, or `fallback` when the scenario has not been run. */
export function fact(id, key, fallback) {
	const value = TRACES[id]?.facts?.[key];
	return value === undefined ? fallback : value;
}

/** The first host event of `id` that matches. */
export function event(id, match) {
	return TRACES[id]?.trace.find((entry) => entry.kind === "host" && matches(entry.event, match))?.event;
}

const matches = (event, match) => Object.entries(match).every(([key, value]) => (typeof value === "function" ? value(event[key]) : event[key] === value));

/**
 * A step's mark: the predicate for the last log entry the step covers. `{ host: {...}, run, nth }` matches a host
 * event; `{ driver: /re/ }`, `{ note: /re/ }`, `{ check: /re/ }` match the other kinds.
 */
export function markIndex(trace, mark) {
	if (!trace || !mark) return -1;
	let seen = 0;
	for (let i = 0; i < trace.length; i++) {
		const entry = trace[i];
		let hit = false;
		if (mark.host && entry.kind === "host" && (mark.run === undefined || entry.run === mark.run)) hit = matches(entry.event, mark.host);
		if (mark.driver && entry.kind === "driver") hit = mark.driver.test(entry.text);
		if (mark.note && entry.kind === "note") hit = mark.note.test(entry.text);
		if (mark.check && entry.kind === "check") hit = mark.check.test(entry.label);
		if (mark.end) hit = i === trace.length - 1;
		if (hit && ++seen === (mark.nth ?? 1)) return i;
	}
	return -1;
}

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const short = (value, max = 64) => {
	const text = (typeof value === "string" ? value : JSON.stringify(value)).replaceAll("\n", " ⏎ ");
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** One trace entry as a line of the run log, the way the scenario printed it. */
export function formatEntry(entry) {
	if (entry.kind === "driver") return `<span class="drv">▸ ${esc(entry.text)}</span>`;
	if (entry.kind === "note") return esc(entry.text);
	if (entry.kind === "check") return `<span class="${entry.ok ? "good" : "bad"}">${entry.ok ? "✓" : "✗"}</span> ${esc(entry.label)}`;
	const run = `<span class="log__run">[${esc(entry.run)}]</span> `;
	const e = entry.event;
	switch (e.event) {
		case "open":
			return `${run}host up (pid ${e.pid})`;
		case "intake":
			return `${run}intake event ${esc(e.id)}: ${e.rejected === undefined ? `submission <b>${e.submission}</b>` : `<span class="bad">rejected</span>, ${esc(e.rejected)}`}`;
		case "call":
			return `${run}${esc(e.who)} → <b>${esc(e.tool)}</b> ${esc(short(e.args, 48))}`;
		case "result":
			return `${run}${esc(e.who)} ← ${esc(e.tool)}${e.isError ? ' <span class="bad">error</span>' : ""}: ${esc(short(e.text, 70))}`;
		case "answer":
			return `${run}${esc(e.who)}: ${esc(short(e.text))}`;
		case "signal":
			return `${run}<span class="drv">signal ${esc(e.id)} allow=${e.allow} → ${esc(e.result)}</span>`;
		case "crash":
			return `${run}<span class="bad">crash point ${esc(e.at)}: exit 137</span>`;
		case "settled":
			return `${run}submission ${e.submission} settled: ${esc(e.status)}`;
		case "exit":
			return `${run}host exits cleanly`;
		case "forked":
			return `${run}forked at entry ${esc(e.at)}: conversation ${esc(e.conversation)}, branch <b>${esc(e.branch)}</b>`;
		default:
			return `${run}${esc(short(e))}`;
	}
}
