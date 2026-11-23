// Scenarios E–I: each starts the host as a child process in a fresh run directory, kills and restarts it where the
// scenario says, and then checks the store and the files.
//
//   npm run demo2 [-- G]       workers on LayerFS Branches (workspaces.ts): each scenario runs in its own project's
//                              client container (shared/container.ts), and this file runs there
//   npm run demo2:dir [-- G]   workers in copies of a plain directory, on this machine: the control group; its
//                              traces are named E-dir … I-dir
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { lines, readTree, treeHash } from "../demo1/scenarios.ts";
import { scenarioInClient } from "../shared/container.ts";
import { type HostEvent, type HostRun, runHost } from "../shared/driver.ts";
import * as layerfs from "../shared/lfs.ts";
import { check, driverEvent, fact, note, scenario, summary } from "../shared/report.ts";
import { FIX_A } from "../shared/script.ts";
import type { IssueEvent } from "./admission.ts";
import { inspectRun, type RunState } from "./inspect.ts";
import { needsApproval } from "./policy.ts";
import { KIND } from "./workspaces.ts";

const ROOT = resolve(import.meta.dirname, "..");
const HOST = join(ROOT, "demo2/host.ts");
const APPROVE = join(ROOT, "demo2/approve.ts");
const LFS = KIND === "lfs";
/** The scenario's name in the summary and its trace: the directory runs are the control group. */
const id = (name: string) => (LFS ? name : `${name}-dir`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TITLES = ["Hello World", "Hello, World!", "  many   spaces ", "C++ for Dummies", "50% off today", "Why? Because!", "Rock & Roll", "e-mail me", "Version 2.0 is out", "The End."];

/** The repository the issue is about. gen_slugs.py is the slow build step a worker runs before the tests. */
const SEED: Record<string, string> = {
	"fix.py": `def slugify(title: str) -> str:
    return title.lower().replace(" ", "-")
`,
	"test_fix.py": `from fix import slugify


def test_basic():
    assert slugify("Hello World") == "hello-world"


def test_punctuation():
    assert slugify("Hello, World!") == "hello-world"


def test_spaces():
    assert slugify("  many   spaces ") == "many-spaces"
`,
	"gen_slugs.py": `"""Write slugs.txt, the slug of every title in titles.txt. Slow on purpose: a build step that writes its output a
line at a time."""
import time

from fix import slugify

open("slugs.txt", "w").close()
for title in open("titles.txt").read().splitlines():
    with open("slugs.txt", "a") as out:
        out.write(slugify(title) + "\\n")
    time.sleep(0.5)
`,
	"titles.txt": `${TITLES.join("\n")}\n`,
};

/** main after a run without crashes: worker a's fix.py, and the slugs.txt it generated. */
const slugA = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const CLEAN_MAIN: Record<string, string> = { ...SEED, "fix.py": FIX_A, "slugs.txt": `${TITLES.map(slugA).join("\n")}\n` };

const ISSUE: IssueEvent = {
	id: "42",
	author: "alice",
	labels: ["agent", "bug"],
	title: "slugify keeps punctuation",
	body: 'slugify("Hello, World!") should give "hello-world".',
};

/** Use the driver's own LayerFS client for `fn`, then close it, so it is never open beside a host's. */
async function lfs<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} finally {
		await layerfs.closeLfs();
	}
}

async function setup(name: string, events: IssueEvent[]): Promise<string> {
	const runDir = join(ROOT, "runs", `demo2-${id(name)}`);
	rmSync(runDir, { recursive: true, force: true });
	// LayerFS: the seed becomes the project's main. Directories: it is main/.
	const main = join(runDir, LFS ? "seed" : "main");
	mkdirSync(main, { recursive: true });
	for (const [path, text] of Object.entries(SEED)) writeFileSync(join(main, path), text);
	writeFileSync(join(runDir, "events.json"), `${JSON.stringify(events, null, 2)}\n`);
	note(`run directory: ${runDir}`);
	if (LFS) {
		await lfs(() => layerfs.initProject(main));
		note(`LayerFS project ${layerfs.projectName()}; main holds ${Object.keys(SEED).join(", ")}`);
	}
	return runDir;
}

/** The files of main, or of a worker's workspace (a Branch or a directory). */
function files(runDir: string, where: string): Promise<Record<string, string>> {
	if (LFS) return lfs(() => layerfs.readTree(where));
	return Promise.resolve(readTree(where === "main" ? join(runDir, "main") : where));
}

const TESTS = "PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider";

/** Run the tests on main: in a Sandbox, on a Branch forked from main (main itself cannot be mounted), or here. */
async function testsPassOnMain(runDir: string): Promise<boolean> {
	if (LFS) {
		return lfs(async () => {
			await layerfs.forkOnce("check-main", "main");
			const ws = await layerfs.mount("check-main");
			const client = await layerfs.lfs();
			try {
				return (await client.workspace.exec(ws, TESTS, "run the tests on main")).exitCode === 0;
			} finally {
				await client.workspace.unmount(ws, true);
			}
		});
	}
	try {
		execFileSync("bash", ["-c", TESTS], { cwd: join(runDir, "main"), stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const pendingIds = (runDir: string) =>
	(existsSync(join(runDir, "approvals/pending")) ? readdirSync(join(runDir, "approvals/pending")) : [])
		.filter((file) => file.endsWith(".json"))
		.map((file) => file.slice(0, -".json".length));

/** Answer through the same CLI a person would use. */
function approve(runDir: string, approval: string, decision: "yes" | "no"): void {
	driverEvent(`approve ${approval} ${decision}`);
	try {
		execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", APPROVE, approval, decision], {
			env: { ...process.env, RUN_DIR: runDir },
			stdio: "pipe",
		});
	} catch (error) {
		driverEvent(`approve failed: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`);
	}
}

/** A tick that answers every pending approval with yes, once. */
function autoApprove(runDir: string) {
	const answered = new Set<string>();
	return () => {
		for (const approval of pendingIds(runDir)) {
			if (answered.has(approval)) continue;
			answered.add(approval);
			approve(runDir, approval, "yes");
		}
		return undefined;
	};
}

const host = (label: string, runDir: string, extra: Partial<Parameters<typeof runHost>[0]> = {}) =>
	runHost({ label, script: HOST, runDir, tick: autoApprove(runDir), ...extra });

const of = (events: readonly HostEvent[], kind: string) => events.filter((event) => event.event === kind);
const calls = (state: RunState, tool: string) => state.router.filter((step) => step.kind === "call" && step.tool === tool);
const results = (state: RunState, tool: string) =>
	state.router.filter((step): step is Extract<typeof step, { kind: "result" }> => step.kind === "result" && step.tool === tool);
const inputs = (steps: RunState["router"]) => steps.filter((step) => step.kind === "input").length;
const exitOf = (run: HostRun) => (run.signal === null ? `exit ${run.code}` : run.signal);
const interruptedIn = (state: RunState) =>
	Object.entries(state.workers).flatMap(([name, worker]) =>
		worker.steps.filter((step) => step.kind === "result" && /was interrupted/.test(step.text)).map(() => name),
	);

function checkWorkers(state: RunState): void {
	fact("conversations", state.conversations);
	fact("workerInputs", Object.fromEntries(Object.entries(state.workers).map(([name, worker]) => [name, inputs(worker.steps)])));
	fact("workspaces", Object.fromEntries(Object.entries(state.workers).map(([name, worker]) => [name, worker.where.replace(`${ROOT}/`, "")])));
	check("2 worker conversations in the store, no duplicates", state.conversations === 3, `${state.conversations} conversations incl. the router`);
	for (const [name, worker] of Object.entries(state.workers)) {
		check(`worker ${name} was given its task once`, inputs(worker.steps) === 1, `${inputs(worker.steps)} input(s)`);
	}
}

/** main has worker a's work and nothing of b's, and the tests pass on it. Returns main's files. */
async function checkLanded(runDir: string, state: RunState): Promise<Record<string, string>> {
	const main = await files(runDir, "main");
	const a = state.workers.a === undefined ? {} : await files(runDir, state.workers.a.where);
	const b = state.workers.b === undefined ? {} : await files(runDir, state.workers.b.where);
	fact("mainFix", main["fix.py"]);
	fact("workerFix", { a: a["fix.py"], b: b["fix.py"] });
	fact("mainFiles", main);
	fact("mainHash", treeHash(main));
	check("main has worker a's fix.py and slugs.txt", main["fix.py"] === a["fix.py"] && main["slugs.txt"] === a["slugs.txt"]);
	check(`worker b's ${LFS ? "branch" : "directory"} is kept, not merged`, b["fix.py"] !== undefined && main["fix.py"] !== b["fix.py"]);
	check("main's test_fix.py is unchanged", main["test_fix.py"] === SEED["test_fix.py"]);
	const passed = await testsPassOnMain(runDir);
	fact("mainTestsPass", passed);
	check("tests pass on main", passed);
	return main;
}

/** Compare main with a run without crashes. */
function compareClean(main: Record<string, string>, expectSame: boolean): void {
	const same = treeHash(main) === treeHash(CLEAN_MAIN);
	note(`main ${treeHash(main)}, a clean run ${treeHash(CLEAN_MAIN)}: slugs.txt has ${lines(main["slugs.txt"])} lines (${TITLES.length} titles)`);
	fact("cleanHash", treeHash(CLEAN_MAIN));
	fact("slugLines", lines(main["slugs.txt"]));
	if (expectSame) check("main matches a run without crashes", same, `${treeHash(main)} vs ${treeHash(CLEAN_MAIN)}`);
	else check("main does not match a run without crashes", !same, `${treeHash(main)} vs ${treeHash(CLEAN_MAIN)}`);
}

const done = async () => {
	if (LFS) await lfs(() => layerfs.closeSandboxes());
};

const SCENARIOS: Record<string, { title: string; expected: string; run: () => Promise<void> }> = {
	E: {
		title: "the same event delivered twice",
		expected: "both deliveries get the same submission; one run",
		async run() {
			const runDir = await setup("E", [ISSUE, ISSUE, { ...ISSUE, id: "43", labels: ["bug"] }, { ...ISSUE, id: "44", author: "mallory" }]);
			const first = await host("run 1", runDir);
			note("redeliver event 42 to a new host process after the run finished");
			writeFileSync(join(runDir, "events.json"), JSON.stringify([ISSUE]));
			const second = await host("run 2", runDir);
			const ids = [...of(first.events, "intake"), ...of(second.events, "intake")]
				.filter((event) => event.id === "42")
				.map((event) => event.submission);
			const state = await inspectRun(runDir);
			fact("submissionIds", ids);
			fact("routerInputs", inputs(state.router));
			check("3 deliveries of event 42, one submission id", ids.length === 3 && new Set(ids).size === 1, ids);
			check("the router got the event once", inputs(state.router) === 1, `${inputs(state.router)} input(s)`);
			check("one dispatch per worker", calls(state, "spawn_worker").length === 2);
			check("the redelivery ran nothing", of(second.events, "call").length === 0);
			const rejected = of(first.events, "intake").filter((event) => event.rejected !== undefined);
			check("events 43 and 44 rejected before any submission", rejected.length === 2, rejected.map((event) => `${event.id}: ${event.rejected}`));
			// The second mandate rule, which no worker here trips: the same gate parks risky bash commands.
			const gated = ["git push origin main", "rm -rf build", "ls -la"].map((command) => needsApproval("bash", { command }) !== undefined);
			check("policy rule 2 gates git push and rm -rf, not ls", gated.join() === "true,true,false", gated);
			await done();
		},
	},

	F: {
		title: "crash right after the second spawn_worker",
		expected: "still 2 workers, nothing dispatched twice; the router keeps waiting",
		async run() {
			const runDir = await setup("F", [ISSUE]);
			const first = await host("run 1", runDir, { env: { CRASH_AT: "after-spawn-b" } });
			check("run 1 dies at the crash point", first.code === 137, exitOf(first));
			note("restart");
			const second = await host("run 2", runDir);
			check("run 2 finishes", second.code === 0, exitOf(second));
			const state = await inspectRun(runDir);
			checkWorkers(state);
			check("spawn_worker b ran again and reused its worker", results(state, "spawn_worker").length === 2);
			check("the router went on to wait_workers and land", calls(state, "wait_workers").length === 1 && results(state, "land").length === 1);
			fact("spawnResults", results(state, "spawn_worker").length);
			const interrupted = interruptedIn(state);
			fact("interrupted", interrupted);
			note(
				interrupted.length > 0
					? `worker tool calls cut off by the crash: ${interrupted.join(", ")} (bash is not replay-safe: the model was told, and reran it)`
					: LFS
						? "worker tool calls cut off by the crash ran again by themselves (replay-safe)"
						: "no worker tool call was cut off by the crash",
			);
			await checkLanded(runDir, state);
			await done();
		},
	},

	G: {
		title: "crash while land waits for approval",
		expected: "after restart it still waits; approve <id> yes lets land finish",
		async run() {
			const runDir = await setup("G", [ISSUE]);
			const first = await host("run 1", runDir, {
				tick: () => (pendingIds(runDir).length > 0 ? "kill" : undefined),
			});
			check("run 1 killed while land waits for approval", first.signal === "SIGKILL", exitOf(first));
			const parked = pendingIds(runDir);
			note(`pending: ${parked.join(", ")}`);
			fact("parked", parked);

			note("restart; this time the host also crashes right after delivering the approval signal");
			let opened = 0;
			let stillParked: boolean | undefined;
			const second = await host("run 2", runDir, {
				env: { CRASH_AT: "after-signal" },
				tick: async (events) => {
					if (stillParked !== undefined || of(events, "open").length === 0) return undefined;
					opened ||= Date.now();
					if (Date.now() - opened < 1000) return undefined;
					// A second after the restart: land has not run, and the question is still open.
					stillParked = !events.some((event) => event.event === "result" && event.tool === "land") && pendingIds(runDir).length === 1;
					check("after the restart land still waits for approval", stillParked, pendingIds(runDir));
					approve(runDir, pendingIds(runDir)[0]!, "yes");
					return undefined;
				},
			});
			check("run 2 dies right after the signal", second.code === 137, exitOf(second));
			note("restart: the answer file was not moved to done/, so it is signalled again");
			// No approver this time: the answer is already on disk.
			const third = await host("run 3", runDir, { tick: undefined });
			check("run 3 finishes", third.code === 0, exitOf(third));
			const signals = [...of(second.events, "signal"), ...of(third.events, "signal")].map((event) => event.result);
			fact("signals", signals);
			check("the repeated signal answers duplicate; the first value stands", signals.join(",") === "delivered,duplicate", signals);
			const state = await inspectRun(runDir);
			check("land ran exactly once", results(state, "land").length === 1, results(state, "land").map((r) => r.text));
			check("no approval left pending", pendingIds(runDir).length === 0);
			await checkLanded(runDir, state);
			await done();
		},
	},

	H: {
		title: "a full run",
		expected: "main has only worker a's change; b's work is kept but not merged",
		async run() {
			const runDir = await setup("H", [ISSUE]);
			const run = await host("run 1", runDir);
			check("the run finishes", run.code === 0, exitOf(run));
			const state = await inspectRun(runDir);
			checkWorkers(state);
			const waited = results(state, "wait_workers")[0]?.text ?? "";
			fact("waited", waited);
			fact("landed", results(state, "land")[0]?.text);
			check("wait_workers reports a passing, b failing", /a: done, tests exit 0/.test(waited) && /b: done, tests exit [1-9]/.test(waited), waited);
			check("the router landed a", calls(state, "land").some((step) => step.kind === "call" && step.args.name === "a"));
			compareClean(await checkLanded(runDir, state), true);
			await done();
		},
	},

	I: {
		title: "kill the host while worker a's bash runs",
		expected: LFS
			? "worker a's leftover Workspace is discarded and its bash reruns; main ends as in a run without crashes"
			: "the orphaned command and its rerun both write worker a's directory; main does not match a run without crashes",
		async run() {
			const runDir = await setup("I", [ISSUE]);
			const approveAll = autoApprove(runDir);
			let started: number | undefined;
			const first = await host("run 1", runDir, {
				tick: (events) => {
					approveAll();
					started ??= events.some((event) => event.event === "call" && event.who === "worker:a" && event.tool === "bash") ? Date.now() : undefined;
					return started !== undefined && Date.now() - started >= 2000 ? "kill" : undefined;
				},
			});
			check("run 1 killed 2 s into worker a's bash", first.signal === "SIGKILL", exitOf(first));
			const state1 = await inspectRun(runDir);
			const branchA = state1.workers.a?.where ?? "";
			if (LFS) {
				const left = await lfs(async () => {
					const [ws] = await layerfs.leftovers(branchA);
					if (ws === undefined) return undefined;
					const atKill = await layerfs.peekLines(ws, "slugs.txt");
					await sleep(1000);
					return { ws, atKill, later: await layerfs.peekLines(ws, "slugs.txt") };
				});
				check("worker a's Workspace is left mounted, its command still writing", left !== undefined && left.later > left.atKill, left && `${left.atKill} → ${left.later} lines`);
				if (left !== undefined) {
					note(`slugs.txt in worker a's leftover Workspace: ${left.atKill} lines when the host died, ${left.later} a second later; on its branch nothing yet`);
					fact("atKill", left.atKill);
					fact("later", left.later);
				}
			} else {
				const atKill = lines(readTree(branchA)["slugs.txt"]);
				await sleep(1000);
				const later = lines(readTree(branchA)["slugs.txt"]);
				note(`slugs.txt in worker a's directory: ${atKill} lines when the host died, ${later} a second later (its command is an orphan and keeps writing)`);
				fact("atKill", atKill);
				fact("later", later);
			}
			driverEvent("restart");
			const second = await host("run 2", runDir);
			check("run 2 finishes", second.code === 0, exitOf(second));
			const state = await inspectRun(runDir);
			checkWorkers(state);
			const rerun = of(second.events, "result").find((event) => event.who === "worker:a" && event.tool === "bash");
			const discarded = ((rerun?.details ?? {}) as { discarded?: layerfs.Discarded[] }).discarded ?? [];
			fact("discarded", discarded);
			fact("interrupted", interruptedIn(state));
			if (LFS) {
				note(`worker a's bash ran again by itself and first discarded ${discarded.map((d) => `${d.path} (killed: ${d.killed.join("; ") || "nothing"})`).join(", ") || "nothing"}`);
				check("the rerun discarded worker a's leftover Workspace and killed its orphan", discarded.length === 1 && discarded[0]!.killed.length > 0);
				check("no worker was told a call was interrupted", interruptedIn(state).length === 0);
			} else {
				check("worker a was told its bash was interrupted, and ran it again", interruptedIn(state).includes("a"));
			}
			check("land ran exactly once", results(state, "land").length === 1);
			compareClean(await checkLanded(runDir, state), LFS);
			await done();
		},
	},
};

if (import.meta.main) {
	const wanted = process.argv.slice(2).map((name) => name.toUpperCase());
	for (const [name, { title, expected, run }] of Object.entries(SCENARIOS)) {
		if (wanted.length > 0 && !wanted.includes(name)) continue;
		if (LFS && process.env.LOCKSTEP_INNER !== "1") {
			await scenarioInClient(name, title, `demo2-${name.toLowerCase()}`, "demo2/scenarios.ts");
			continue;
		}
		scenario(id(name), title, expected);
		await run();
	}
	process.exit(summary() ? 0 : 1);
}
