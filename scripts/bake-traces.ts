// Bake the scenario traces into the site: runs/traces/*.json (written by `npm run demo1` / `npm run demo2`) become
// site/data/traces.js, an ES module the lessons import. A scenario that has not been run keeps its previous baked
// trace, so baking after running only Demo 2 does not drop Demo 1.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FROM = join(ROOT, "runs/traces");
const TO = join(ROOT, "site/data/traces.js");
const PREFIX = "export const TRACES = ";

const baked: Record<string, unknown> = existsSync(TO)
	? (JSON.parse(readFileSync(TO, "utf8").slice(PREFIX.length).replace(/;\s*$/, "")) as Record<string, unknown>)
	: {};
const files = existsSync(FROM) ? readdirSync(FROM).filter((name) => name.endsWith(".json")) : [];
if (files.length === 0) {
	console.error("no traces in runs/traces: run `npm run demo1` and `npm run demo2` first");
	process.exit(1);
}
// Absolute run directories say where the run happened, not what it showed; keep them relative to the repo.
const relativize = (text: string) => text.replaceAll(`${ROOT}/`, "");
for (const file of files.sort()) {
	const trace = JSON.parse(relativize(readFileSync(join(FROM, file), "utf8"))) as { scenario: string; passed: boolean };
	baked[trace.scenario] = trace;
	console.log(`${trace.scenario}: ${trace.passed ? "PASS" : "FAIL"}`);
}
writeFileSync(TO, `${PREFIX}${JSON.stringify(baked)};\n`);
console.log(`wrote ${TO.slice(ROOT.length + 1)} (${Object.keys(baked).sort().join(", ")})`);
