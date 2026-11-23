// Scenarios B–D: the same coder script as A, on the LayerFS tools (tools.ts). Each runs inside its project's client
// container: `npm run demo1 -- B` makes a fresh project and starts this file there (scenarios.ts), and from here the
// host is started, killed and restarted as an ordinary child process, as in A.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { HostEvent, HostRun } from "../shared/driver.ts";
import * as layerfs from "../shared/lfs.ts";
import { check, driverEvent, fact, note, scenario, summary } from "../shared/report.ts";
import { exitOf, freshRun, host, killDuringBash, lines, of, treeHash } from "./scenarios.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const onBranch = (branch: string) => ({ VARIANT: "lfs", LFS_BRANCH: branch });

/** Use the driver's own client for `fn`, then close it, so it is never open beside a host's. */
async function lfs<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} finally {
		await layerfs.closeLfs();
	}
}

/** A fresh project whose main is an empty directory, like A's `work/`. */
async function freshProject(runDir: string): Promise<void> {
	const seed = join(runDir, "seed");
	mkdirSync(seed, { recursive: true });
	await lfs(() => layerfs.initProject(seed));
	note(`LayerFS project ${layerfs.projectName()}: main is an empty directory`);
}

/** A clean run of the script on its own Branch: the reference tree. */
async function cleanRun(name: string): Promise<Record<string, string>> {
	note("clean run first, on branch clean, for the reference tree");
	await host("clean", freshRun(`${name}-clean`), onBranch("clean"));
	const clean = await lfs(() => layerfs.readTree("clean"));
	note(`clean tree ${treeHash(clean)}: b.txt has ${lines(clean["b.txt"])} lines`);
	fact("cleanHash", treeHash(clean));
	fact("cleanLines", lines(clean["b.txt"]));
	fact("cleanFiles", clean);
	return clean;
}

const results = (run: HostRun, tool: string) => of(run.events, "result").filter((event) => event.tool === tool);
const detailsOf = (event: HostEvent | undefined) => (event?.details ?? {}) as Record<string, unknown>;

/** The commits on the Branch, oldest first, as `pi-task:<id>` and what they did. */
async function taskCommits(branch: string) {
	const commits = (await layerfs.commitsSince(branch, null)).reverse();
	return commits.map((commit) => ({ id: commit.id.slice(0, 12), via: commit.via, message: commit.message.split("\n").slice(0, 2).join(" · ") }));
}

/** The final state every scenario checks: the files, one commit per tool call, nothing left mounted. */
async function checkBranch(branch: string, clean: Record<string, string>): Promise<void> {
	const { tree, commits, left } = await lfs(async () => ({
		tree: await layerfs.readTree(branch),
		commits: await taskCommits(branch),
		left: await layerfs.leftovers(branch),
	}));
	note(`final tree ${treeHash(tree)}: b.txt has ${lines(tree["b.txt"])} lines, the clean run ${lines(clean["b.txt"])}`);
	fact("final", lines(tree["b.txt"]));
	fact("treeHash", treeHash(tree));
	fact("files", tree);
	fact("commits", commits);
	const ids = commits.map((commit) => /^pi-task:(\d+)/.exec(commit.message)?.[1]);
	check("one commit per tool call that changed files (write, bash, edit)", commits.length === 3 && new Set(ids).size === 3 && !ids.includes(undefined), commits.map((c) => c.message));
	check("the files match the clean run", treeHash(tree) === treeHash(clean), `${treeHash(tree)} vs clean ${treeHash(clean)}`);
	check("no Workspace left mounted", left.length === 0, left.map((ws) => ws.path));
}

export const SCENARIOS: Record<string, () => Promise<void>> = {
	async B() {
		scenario("B", "LayerFS: kill bash 2 s in, restart", "the leftover Workspace is discarded and bash reruns; the files match the clean run");
		const runDir = freshRun("B");
		await freshProject(runDir);
		const clean = await cleanRun("B");

		const first = await host("run 1", runDir, onBranch("coder"), killDuringBash());
		check("run 1 killed mid-command", first.signal === "SIGKILL", exitOf(first));
		const left = await lfs(async () => {
			const [ws] = await layerfs.leftovers("coder");
			if (ws === undefined) return undefined;
			const atKill = await layerfs.peekLines(ws, "b.txt");
			await sleep(1000);
			const later = await layerfs.peekLines(ws, "b.txt");
			return { ws, atKill, later, branch: lines((await layerfs.readTree("coder"))["b.txt"]) };
		});
		check("a Workspace is left mounted on the branch", left !== undefined, left && `${left.ws.sandbox}:${left.ws.path}, ${left.ws.activity}`);
		if (left !== undefined) {
			note(`b.txt in that Workspace: ${left.atKill} lines when the process died, ${left.later} a second later (the command is an orphan in the Sandbox and keeps writing, into the Workspace only)`);
			note(`b.txt on the branch: ${left.branch} lines; nothing was committed`);
			fact("atKill", left.atKill);
			fact("later", left.later);
			fact("onBranchAtKill", left.branch);
			fact("leftover", { path: `${left.ws.sandbox}:${left.ws.path}`, activity: left.ws.activity, changed: left.ws.changed });
		}

		driverEvent("restart");
		const second = await host("run 2", runDir, onBranch("coder"));
		check("run 2 finishes", second.code === 0, exitOf(second));
		const rerun = results(second, "bash")[0];
		const discarded = (detailsOf(rerun).discarded ?? []) as layerfs.Discarded[];
		fact("discarded", discarded);
		note(`the rerun of bash discarded ${discarded.map((d) => `${d.path} (killed: ${d.killed.join("; ") || "nothing"})`).join(", ") || "nothing"}`);
		check("the rerun discarded the leftover Workspace and killed its orphan", discarded.length === 1 && discarded[0]!.killed.length > 0);
		const interrupted = [...first.events, ...second.events].some((event) => event.event === "result" && /interrupted/i.test(String(event.text)));
		check("bash ran again by itself; the model was never told it was interrupted", rerun !== undefined && !interrupted);
		await checkBranch("coder", clean);
		await lfs(() => layerfs.closeSandboxes());
	},

	async C() {
		scenario("C", "LayerFS: crash right after the bash commit", "bash does not run again: its result comes back from its commit");
		const runDir = freshRun("C");
		await freshProject(runDir);
		const clean = await cleanRun("C");

		const first = await host("run 1", runDir, { ...onBranch("coder"), CRASH_AT: "after-commit" });
		check("run 1 dies right after committing bash's Workspace", first.code === 137, exitOf(first));
		const after = await lfs(async () => ({ commits: await taskCommits("coder"), left: await layerfs.leftovers("coder") }));
		const execCommit = after.commits.find((commit) => commit.via === "exec");
		note(`on the branch: ${after.commits.map((c) => `"${c.message}"`).join(", ")}; the tool result never reached the Pi store`);
		fact("commitsAtCrash", after.commits);
		fact("leftAtCrash", after.left.map((ws) => ({ path: `${ws.sandbox}:${ws.path}`, changed: ws.changed })));
		check("bash's commit is on the branch, its Workspace still mounted (and clean)", execCommit !== undefined && after.left.length === 1 && !after.left[0]!.changed);

		driverEvent("restart");
		const second = await host("run 2", runDir, onBranch("coder"));
		check("run 2 finishes", second.code === 0, exitOf(second));
		const rerun = detailsOf(results(second, "bash")[0]);
		fact("replayed", rerun);
		check("bash was not run again: its result came from the commit", rerun.replayed === true && rerun.commit !== undefined, rerun);
		await checkBranch("coder", clean);
		await lfs(() => layerfs.closeSandboxes());
	},

	async D() {
		scenario("D", "fork the finished run at its first tool result", "the fork gets its own branch and another a.txt; the original branch does not change");
		const runDir = freshRun("D");
		await freshProject(runDir);
		const first = await host("run 1", runDir, onBranch("coder"));
		check("run 1 finishes", first.code === 0, exitOf(first));
		const at = of(first.events, "result")[0];
		const before = await lfs(async () => ({ tree: await layerfs.readTree("coder"), head: await layerfs.head("coder") }));
		note(`fork the conversation at entry ${at?.entry} (the result of ${at?.tool} a.txt) and send it "[alt]"`);
		fact("forkAt", at?.entry);
		fact("before", before.tree);

		const fork = await host("fork", runDir, { ...onBranch("coder"), FORK_AT: String(at?.entry) });
		check("the fork finishes", fork.code === 0, exitOf(fork));
		const forked = of(fork.events, "forked")[0];
		const branch = String(forked?.branch);
		note(`the fork is conversation ${forked?.conversation}, on branch ${branch}`);
		const after = await lfs(async () => ({
			fork: await layerfs.readTree(branch),
			original: await layerfs.readTree("coder"),
			head: await layerfs.head("coder"),
			forkCommits: await taskCommits(branch),
		}));
		fact("forkBranch", branch);
		fact("forkFiles", after.fork);
		fact("originalFiles", after.original);
		fact("forkCommits", after.forkCommits);
		check("the fork's a.txt is the other version", after.fork["a.txt"] === "version 2 (alt)\n", after.fork["a.txt"]);
		check("the fork's b.txt was built again on its branch, 10 lines", lines(after.fork["b.txt"]) === 10, `${lines(after.fork["b.txt"])} lines`);
		check("the original branch is unchanged", after.head === before.head && treeHash(after.original) === treeHash(before.tree), after.original["a.txt"]);
		await lfs(() => layerfs.closeSandboxes());
	},
};

if (import.meta.main) {
	for (const name of process.argv.slice(2).map((arg) => arg.toUpperCase())) await SCENARIOS[name]?.();
	process.exit(summary() ? 0 : 1);
}
