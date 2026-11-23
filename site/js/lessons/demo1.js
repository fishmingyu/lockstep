// Demo 1: one coder, four steps (write a.txt, a 5 s bash loop into b.txt, edit a.txt, answer). Scenario A is the
// control group on Pi's CodingTools; B–D run the LayerFS tools (demo1/tools.ts). All four are recorded runs.
import { event, fact } from "../trace.js";

const LOOP = 'for i in $(seq 1 10); do echo "line $i" >> b.txt; sleep 0.5; done';
const short = (hash) => (hash ? `${hash.slice(0, 8)}…` : "—");

// ── recorded facts for A ─────────────────────────────────────────────────
const A = {
	atKill: fact("A", "atKill", 4),
	later: fact("A", "later", 6),
	final: fact("A", "final", 20),
	clean: fact("A", "cleanHash", "3bc38745e34fc845"),
	tree: fact("A", "treeHash", "1eed7010f8356aed"),
	cleanLines: fact("A", "cleanLines", 10),
	interrupted: event("A", { event: "result", tool: "bash", isError: true })?.text ?? "Tool bash was interrupted and may have partially run",
};
const bLines = String(fact("A", "files", {})["b.txt"] ?? "")
	.split("\n")
	.filter(Boolean);
const restartAt = bLines.indexOf("line 1", 1);
const interleaved = restartAt > 0 && bLines[restartAt + 1] !== "line 2";
const snippet = restartAt > 0 ? bLines.slice(restartAt - 1, restartAt + 4).join(", ") : "";

// ── the shared picture ───────────────────────────────────────────────────
const base = () => ({
	driver: { kind: "block", at: [0.3, 5.3], size: [2, 2, 1.3], tone: "paper", icon: "terminal", label: "driver" },
	coder: { kind: "block", at: [-5.6, 0.2], size: [2.2, 2.2, 1.7], tone: "violet", icon: "bot", label: "coder", sub: "scripted" },
	host: { kind: "block", at: [0, 0], size: [2.6, 2.6, 2.1], tone: "blue", icon: "cpu", label: "host", sub: "run 1", key: 1 },
	store: { kind: "cylinder", at: [0.15, -6], r: 1.15, h: 1.8, tone: "yellow", icon: "db", tags: [{ text: "session.sqlite", pos: "right" }] },
	work: { kind: "slab", at: [8, -0.6], size: [5.2, 3.1, 0.35], tone: "paper", tags: [{ text: "work/", icon: "folder", pos: "bottom" }] },
	afile: { kind: "file", at: [8.6, 0.4, 0.35], w: 1.7, text: "version 1", tags: [{ text: "a.txt", pos: "left", dy: 10 }] },
	bfile: { kind: "file", at: [11.2, 0.4, 0.35], w: 1.3, lines: 0, tags: [{ text: "b.txt", pos: "right" }] },
	shell: { kind: "block", at: [4.6, -2.8], size: [1.7, 1.7, 1.25], tone: "rose", icon: "terminal", label: "bash", labelSize: 12 },
	clean: { kind: "slab", at: [9.6, -6.4], size: [4.4, 3, 0.35], tone: "green", state: "dim", tags: [{ text: "clean run", icon: "check", pos: "bottom", tone: "green" }] },
	cleanA: { kind: "file", at: [10.2, -5.6, 0.35], w: 1.7, text: "version 2", state: "dim" },
	cleanB: { kind: "file", at: [12.4, -5.6, 0.35], w: 1.3, lines: 10, state: "dim" },
});
const baseEdges = () => ({
	"e-drv": { from: "driver", to: "host", label: "start", dashed: true, tone: "muted" },
	"e-model": { from: "host", to: "coder", label: "next step?", arrow: "both" },
	"e-store": { from: "host", to: "store", label: "commit entry", tone: "green" },
	"e-write": { from: "host", to: "afile", label: "write", labelAt: 0.35, z: 0.45 },
	"e-spawn": { from: "host", to: "shell", dashed: true, label: "spawn", dy0: -0.7 },
	"e-append": { from: "shell", to: "bfile", tone: "rust", flow: true, label: "append", labelAt: 0.4, z: 0.45 },
});

const HUD_A = [
	{ key: "b", label: "b.txt", icon: "file" },
	{ key: "host", label: "host", icon: "cpu" },
	{ key: "model", label: "model sees", icon: "bot" },
	{ key: "tree", label: "tree vs clean", icon: "hash" },
];

const LEGEND = [
	["#9b85e0", "model ↔ host"],
	["#7fc278", "committed to the store"],
	["var(--rust)", "writes to files"],
];

export const lessonA = {
	id: "a-control",
	scenario: "A",
	nav: "A · Kill mid-command",
	title: "Kill It Mid-Command",
	subtitle: "The control group: Pi's own CodingTools on a plain directory. SIGKILL the host while bash runs, restart, and compare the files with a clean run.",
	minutes: 6,
	hud: HUD_A,
	legend: LEGEND,
	nodes: base(),
	edges: baseEdges(),
	learn: [
		[0, "What survives a SIGKILL: the session store"],
		[3, "Why a shell command can't simply be replayed"],
		[5, "What an orphaned command does to your files"],
		[6, "What the model is told after a restart"],
		[9, "How a scenario checks the result against a clean run"],
	],
	steps: [
		{
			short: "The task",
			badge: "problem",
			title: "An agent with real side effects",
			body: [
				"One coder conversation, driven by a scripted model, does four things: **write** `a.txt`, run a **bash** loop that appends a line to `b.txt` every 0.5 s for 5 s, **edit** `a.txt`, and answer *Done*.",
				"The driver (`demo1/scenarios.ts`) starts the host as a child process so it can kill it at the worst moment. This lesson is the control group: Pi's own CodingTools on a plain directory.",
			],
			callout: ["key", "Every model reply and every tool result is an entry in `session.sqlite`, committed before the next step. A restarted host reads the store and carries on from the last committed entry."],
			changed: [
				["+", "host process, run 1"],
				["+", "`session.sqlite`"],
				["+", "`work/`, empty"],
			],
			show: ["driver", "host", "coder", "store", "work", "e-drv", "e-model", "e-store"],
			hud: { b: "0 / 10", host: "run 1" },
			log: { note: /clean run first/ },
		},
		{
			short: "Clean run",
			badge: "setup",
			title: "First, a clean run to compare with",
			body: [
				"Before any crash the driver runs the same script once, start to finish, in its own directory. That tree — `a.txt` says *version 2*, `b.txt` has " + A.cleanLines + " lines — hashes to `" + A.clean + "`.",
				"Every crash run ends the same way: hash its directory and compare.",
			],
			changed: [["+", `clean tree \`${A.clean}\``]],
			show: ["clean", "cleanA", "cleanB"],
			set: { clean: { tags: [{ text: `clean ${short(A.clean)}`, icon: "check", pos: "bottom", tone: "green" }] } },
			hud: { tree: `clean ${short(A.clean)}` },
			log: { note: /clean tree/ },
		},
		{
			short: "write",
			badge: "run",
			title: "write a.txt",
			body: [
				"The host asks the model for the next step; the model answers with a tool call, `write a.txt`. The host runs it and commits the call and its result as entries before asking again.",
				"`a.txt` now says *version 1*.",
			],
			show: ["afile", "e-write"],
			packets: [
				{ edge: "e-model", tone: "violet", reverse: true, dur: 1100 },
				{ edge: "e-write", tone: "rust", delay: 1100, dur: 1000 },
				{ edge: "e-store", tone: "green", delay: 2100, dur: 1000 },
			],
			changed: [
				["+", "`a.txt` = version 1"],
				["+", "entries: the write call and its result"],
			],
			log: { host: { event: "result", tool: "write" }, run: "run 1" },
		},
		{
			short: "bash",
			badge: "run",
			title: "bash: the loop starts",
			body: [
				"Next the model calls **bash** with `" + LOOP + "`. The host spawns a shell and waits for it to exit.",
				"The call is committed. Its result is not — there is none yet. `b.txt` grows by a line every half second.",
			],
			callout: ["warn", "bash is not replay-safe: running it twice is not the same as running it once. After a crash, Pi Durable can't just run it again for you."],
			show: ["shell", "bfile", "e-spawn", "e-append"],
			hide: ["e-write"],
			set: { bfile: { lines: Math.max(1, A.atKill - 1) } },
			packets: [{ edge: "e-append", tone: "rust", count: 3, spacing: 500, dur: 900 }],
			hud: { b: `${Math.max(1, A.atKill - 1)} / 10` },
			log: { host: { event: "call", tool: "bash" }, run: "run 1" },
		},
		{
			short: "SIGKILL",
			badge: "crash",
			title: "SIGKILL, two seconds in",
			body: [
				"Two seconds after the bash call starts, the driver sends **SIGKILL** to the host. No handler runs, nothing is flushed.",
				`At that moment \`b.txt\` has **${A.atKill} of 10** lines. The store has the bash call, and no result for it.`,
			],
			changed: [
				["bad", "host killed (SIGKILL)"],
				["~", `\`b.txt\`: ${A.atKill} / 10 lines`],
			],
			set: {
				host: { state: "dead", tags: [{ text: "SIGKILL", icon: "zap", tone: "rust" }] },
				"e-drv": { label: "SIGKILL", labelTone: "rust", tone: "rust", dashed: false },
				"e-model": { tone: "muted", dashed: true },
				bfile: { lines: A.atKill },
			},
			hide: ["e-store"],
			fx: [{ kind: "kill", at: "host" }],
			hud: { host: { v: "killed", tone: "bad" }, b: `${A.atKill} / 10` },
			log: { driver: /SIGKILL/ },
		},
		{
			short: "Orphan",
			badge: "failure",
			title: "The shell outlives its host",
			body: [
				"SIGKILL takes down the Node process, not the shell it spawned. The loop is now an orphan, and it keeps appending.",
				`One second later \`b.txt\` has **${A.later}** lines. Nobody will ever collect this command's output or exit code.`,
			],
			changed: [["~", `\`b.txt\`: ${A.later} lines, still growing`]],
			hide: ["e-spawn"],
			set: {
				shell: { tags: [{ text: "orphan", icon: "warn", tone: "rust" }], halo: "bad" },
				bfile: { lines: A.later },
			},
			packets: [{ edge: "e-append", tone: "rust", count: 2, spacing: 500, dur: 900 }],
			hud: { b: `${A.later} / 10` },
			log: { note: /1 s later/ },
		},
		{
			short: "Restart",
			badge: "recovery",
			title: "Restart: “interrupted”",
			body: [
				"The driver starts the host again on the same run directory. The Harness reopens `session.sqlite` and finds the bash call without a result.",
				"bash is not replay-safe, so instead of rerunning it the Harness commits an error result and hands the turn back to the model: *" + A.interrupted.replace(/<\/?harness>|\[error\]/g, "").trim() + "*.",
			],
			callout: ["key", "That is the honest answer: neither the harness nor the model knows how far the command got."],
			changed: [
				["+", "host process, run 2"],
				["+", "entry: bash → interrupted (error)"],
			],
			set: {
				host: { key: 2, state: undefined, sub: "run 2", tags: [] },
				"e-drv": { label: "restart", labelTone: undefined, tone: "muted", dashed: true },
				"e-model": { tone: undefined, dashed: false },
				store: { halo: "good" },
			},
			show: ["e-store"],
			packets: [
				{ edge: "e-store", tone: "green", reverse: true, dur: 1000 },
				{ edge: "e-model", tone: "violet", delay: 1000, dur: 1100 },
			],
			hud: { host: "run 2", model: { v: "interrupted", tone: "bad" } },
			log: { host: { event: "result", tool: "bash", isError: true }, run: "run 2" },
		},
		{
			short: "Rerun",
			badge: "failure",
			title: "The model runs it again",
			body: [
				"A real model told that its command was cut off would run it again, and so does the scripted one. A second loop starts while the orphan is still finishing the first.",
				interleaved
					? `They write at the same time — \`b.txt\` reads \`${snippet}\` — and it ends with **${A.final}** lines.`
					: `The rerun appends ten more lines to what the orphan left: \`b.txt\` ends with **${A.final}** lines.`,
			],
			changed: [["bad", `\`b.txt\`: ${A.final} lines, ${A.cleanLines} expected`]],
			show: ["e-spawn"],
			set: {
				store: { halo: undefined },
				shell: { tags: [{ text: "orphan + rerun", icon: "warn", tone: "rust" }], halo: "bad" },
				bfile: { lines: A.final, halo: "bad" },
			},
			packets: [{ edge: "e-append", tone: "rust", count: 4, spacing: 380, dur: 900 }],
			hud: { b: { v: `${A.final} / 10`, tone: "bad" } },
			log: { host: { event: "call", tool: "bash" }, run: "run 2" },
		},
		{
			short: "Done",
			badge: "run",
			title: "edit a.txt, Done",
			body: [
				"The second loop exits 0, so the model goes on: `edit a.txt` to *version 2*, then *Done*. The submission settles and the host exits cleanly.",
				"As far as the store is concerned, the run went fine.",
			],
			hide: ["shell", "e-spawn", "e-append"],
			show: ["e-write"],
			set: { afile: { text: "version 2" }, "e-write": { label: "edit" }, bfile: { halo: undefined } },
			packets: [
				{ edge: "e-model", tone: "violet", reverse: true, dur: 1100 },
				{ edge: "e-write", tone: "rust", delay: 1100, dur: 1000 },
				{ edge: "e-store", tone: "green", delay: 2100, dur: 1000 },
			],
			changed: [["~", "`a.txt` = version 2"], ["+", "answer: Done"]],
			log: { host: { event: "exit" }, run: "run 2" },
		},
		{
			short: "Check",
			badge: "check",
			title: "Compare with the clean run",
			body: [
				`The final tree hashes to \`${A.tree}\`; the clean run's is \`${A.clean}\`. \`b.txt\` has ${A.final} lines where the clean run has ${A.cleanLines}.`,
				"The store recovered exactly. The directory didn't: half a command, an orphan that kept writing, and a rerun on top.",
			],
			callout: ["tip", "Next, B: the same kill with LayerFS underneath, where a command's changes stay in a Workspace until they are committed."],
			changed: [
				["ok", "run 1 killed mid-command"],
				["ok", "the model is told the command was interrupted"],
				["ok", "the files do not match the clean run"],
			],
			set: {
				work: { tags: [{ text: `work/ ${short(A.tree)}`, icon: "x", pos: "bottom", tone: "rust" }] },
				clean: { state: undefined },
				cleanA: { state: undefined },
				cleanB: { state: undefined },
				bfile: { halo: "bad" },
			},
			hud: { tree: { v: "≠ clean", tone: "bad" } },
			log: { end: true },
		},
	],
};


// ── B–D: the LayerFS tools ───────────────────────────────────────────────
// demo1/tools.ts: read, write, edit and bash on the conversation's Branch, all replay-safe. Each call that changes files
// leaves one commit whose message starts `pi-task:<taskId>`; a rerun looks for it before doing anything.
const commitsOf = (id) => fact(id, "commits", []);
const taskOf = (id, n, fallback) => Number(/pi-task:(\d+)/.exec(commitsOf(id)[n]?.message ?? "")?.[1] ?? fallback);
/** "pi-task:13 · write /a.txt" → "pi-task:13 write a.txt" */
const commitText = (id, n, fallback) => (commitsOf(id)[n]?.message ?? fallback).replace(" · ", " ").replace(/\//g, "");

const B = {
	atKill: fact("B", "atKill", 5),
	later: fact("B", "later", 7),
	onBranch: fact("B", "onBranchAtKill", 0),
	leftover: fact("B", "leftover", { path: "1:/workspaces/2" }).path,
	killed: (fact("B", "discarded", [])[0]?.killed ?? ["bash -c for i in …", "sleep 0.5"]).map((k) => k.replace(/^\d+\s+/, "").trim()),
	clean: fact("B", "cleanHash", "3bc38745e34fc845"),
	tree: fact("B", "treeHash", "3bc38745e34fc845"),
	final: fact("B", "final", 10),
	bash: taskOf("B", 1, 17),
};
const killedText = B.killed.map((k) => (k.startsWith("bash -c") ? "the loop's `bash`" : `\`${k}\``)).join(" and ");

const C = {
	atCrash: fact("C", "commitsAtCrash", []).map((c) => `\`${c.message.replace(" · ", " ")}\``).join(" and "),
	replayed: fact("C", "replayed", {}),
	clean: fact("C", "cleanHash", "3bc38745e34fc845"),
	tree: fact("C", "treeHash", "3bc38745e34fc845"),
	bash: taskOf("C", 1, 17),
};

const D = {
	at: fact("D", "forkAt", 14),
	branch: fact("D", "forkBranch", "c1-at-14"),
	bash: taskOf("D", 1, 36),
	edit: taskOf("D", 2, 40),
	forkA: String(fact("D", "forkFiles", {})["a.txt"] ?? "version 2 (alt)\n").trim(),
	parentA: String(fact("D", "originalFiles", {})["a.txt"] ?? "version 2\n").trim(),
};

const lfsBase = (id) => ({
	driver: { kind: "block", at: [0.3, 5.3], size: [2, 2, 1.3], tone: "paper", icon: "terminal", label: "driver" },
	coder: { kind: "block", at: [-5.6, 0.2], size: [2.2, 2.2, 1.7], tone: "violet", icon: "bot", label: "coder", sub: "scripted" },
	host: { kind: "block", at: [0, 0], size: [2.6, 2.6, 2.1], tone: "blue", icon: "cpu", label: "host", sub: "run 1", key: 1 },
	store: { kind: "cylinder", at: [0.15, -6], r: 1.15, h: 1.8, tone: "yellow", icon: "db", tags: [{ text: "session.sqlite", pos: "right" }] },
	sandbox: { kind: "zone", at: [4.2, -4.4], size: [8.6, 4.6], label: "sandbox" },
	shell: { kind: "block", at: [4.9, -3.3], size: [1.7, 1.7, 1.25], tone: "rose", icon: "terminal", label: "bash", labelSize: 12, key: 1 },
	ws: { kind: "slab", at: [7.6, -3.6], size: [4.6, 3.0, 0.3], tone: "blue", key: 1, tags: [{ text: "workspace", icon: "layers", pos: "right", dy: 14 }] },
	wsb: { kind: "file", at: [9.4, -2.6, 0.3], w: 1.3, lines: 0, key: 1, tags: [{ text: "b.txt", pos: "top" }] },
	c0: { kind: "cylinder", at: [5.6, 4.2], r: 0.42, h: 0.34, tone: "grey", bands: 0, tags: [{ text: "branch coder", icon: "branch", pos: "bottom" }] },
	c1: { kind: "cylinder", at: [8.6, 4.2], r: 0.42, h: 0.34, tone: "green", bands: 0, tags: [{ text: commitText(id, 0, "pi-task:13 write a.txt"), pos: "right" }] },
	c2: { kind: "cylinder", at: [11.6, 4.2], r: 0.42, h: 0.34, tone: "green", bands: 0, tags: [{ text: commitText(id, 1, "pi-task:17 exit:0"), pos: "right" }] },
	c3: { kind: "cylinder", at: [14.6, 4.2], r: 0.42, h: 0.34, tone: "green", bands: 0, tags: [{ text: commitText(id, 2, "pi-task:21 edit a.txt"), pos: "right" }] },
});
const lfsEdges = () => ({
	"e-drv": { from: "driver", to: "host", label: "start", dashed: true, tone: "muted" },
	"e-model": { from: "host", to: "coder", label: "next step?", arrow: "both" },
	"e-store": { from: "host", to: "store", label: "commit entry", tone: "green" },
	l01: { from: "c0", to: "c1", arrow: "none", tone: "muted", gap: 0.12, z: 0.17 },
	l12: { from: "c1", to: "c2", arrow: "none", tone: "muted", gap: 0.12, z: 0.17 },
	l23: { from: "c2", to: "c3", arrow: "none", tone: "muted", gap: 0.12, z: 0.17 },
	"e-fs": { from: "host", to: "c1", label: "fs.apply → commit", tone: "green", labelAt: 0.3 },
	"e-spawn": { from: "host", to: "shell", dashed: true, label: "exec", dy0: -0.7 },
	"e-append": { from: "shell", to: "wsb", tone: "rust", flow: true, label: "append", z: 0.4 },
	"e-mount": { from: "c1", to: "ws", dashed: true, tone: "muted", label: "mount", dx1: -0.88, labelAt: 0.45 },
	"e-commit": { from: "ws", to: "c2", tone: "green", label: "commit", dx0: 2.12, labelAt: 0.5 },
	"e-look": { from: "host", to: "c2", tone: "violet", dashed: true, label: "pi-task:<id>?", labelAt: 0.35 },
});
const HUD_LFS = [
	{ key: "ws", label: "workspace", icon: "layers" },
	{ key: "host", label: "host", icon: "cpu" },
	{ key: "model", label: "model sees", icon: "bot" },
	{ key: "branch", label: "branch coder", icon: "branch" },
];
const LEGEND_LFS = [
	["#9b85e0", "model ↔ host"],
	["#7fc278", "committed (store or branch)"],
	["var(--rust)", "writes in the workspace"],
];

export const lessonB = {
	id: "b-layerfs-kill",
	scenario: "B",
	nav: "B · Same kill, on LayerFS",
	title: "Same Kill, on LayerFS",
	subtitle: "SIGKILL the host 2 s into bash again. This time the command runs in a LayerFS Workspace, so what it did half-way can be found and thrown away.",
	minutes: 6,
	hud: HUD_LFS,
	legend: LEGEND_LFS,
	nodes: lfsBase("B"),
	edges: lfsEdges(),
	learn: [
		[0, "What a Workspace is, and why it isn't the branch"],
		[2, "How a tool call is tied to its commit: `pi-task:<taskId>`"],
		[5, "Where an orphaned command writes now"],
		[7, "Why the orphan must die before the discard"],
		[8, "Why the rerun is safe this time"],
	],
	steps: [
		{
			short: "Setup",
			badge: "setup",
			title: "Same task, LayerFS underneath",
			body: [
				"Same coder, same four steps, same SIGKILL two seconds into bash. This time the tools are `demo1/tools.ts`, on LayerFS. The conversation has its own **branch**, `coder`, named in its Branch doc. `write` and `edit` commit straight to that branch; bash runs in a **Workspace** inside a Sandbox container.",
				"The project's main is an empty directory, like A's `work/`.",
			],
			callout: ["key", "A Workspace is a writable layer mounted over the branch head. Nothing in it reaches the branch until it is committed, and it can be thrown away whole."],
			show: ["driver", "host", "coder", "store", "c0", "sandbox", "e-drv", "e-model", "e-store"],
			changed: [["+", "LayerFS project, branch `coder` forked from main"], ["+", "a Sandbox (container) for commands"]],
			hud: { ws: "—", host: "run 1", branch: "no commits" },
			log: { note: /LayerFS project/ },
		},
		{
			short: "Clean run",
			badge: "setup",
			title: "First, a clean run on its own branch",
			body: [
				"The driver runs the script once without a crash, on a branch of its own, `clean`. Its tree — `a.txt` at *version 2*, `b.txt` with 10 lines — hashes to `" + B.clean + "`: the same tree, and the same hash, as A's clean run.",
			],
			changed: [["+", `branch \`clean\`, tree \`${B.clean}\``]],
			hud: { branch: `clean ${short(B.clean)}` },
			log: { note: /clean tree/ },
		},
		{
			short: "write",
			badge: "run",
			title: "write a.txt is one commit",
			body: [
				"`write a.txt` goes through the LayerFS file API: one call, one commit on `coder`, message `" + commitText("B", 0, "pi-task:13 write a.txt") + "`. There is no in-between state for a crash to find.",
				"The task ID in the message is the tool call's own, from Pi Durable. It is the same in every rerun of the call.",
			],
			show: ["c1", "l01", "e-fs"],
			packets: [
				{ edge: "e-model", tone: "violet", reverse: true, dur: 1100 },
				{ edge: "e-fs", tone: "green", delay: 1100, dur: 1300 },
			],
			changed: [["+", `commit \`${commitText("B", 0, "pi-task:13 write a.txt")}\``]],
			hud: { branch: "1 commit" },
			log: { host: { event: "result", tool: "write" }, run: "run 1" },
		},
		{
			short: "bash",
			badge: "run",
			title: "bash runs in a Workspace",
			body: [
				"For bash the tool first memoizes the branch head (a rerun reads the same value back), then mounts a Workspace over it in the Sandbox and runs the loop there. When the command ends, the tool commits the Workspace as `pi-task:" + B.bash + "`, `exit:<code>`, and the output tail.",
				"Until then the lines land in the Workspace only. The branch doesn't see `b.txt` at all.",
			],
			show: ["ws", "wsb", "shell", "e-mount", "e-spawn", "e-append"],
			hide: ["e-fs"],
			set: { wsb: { lines: Math.max(1, B.atKill - 1) } },
			packets: [{ edge: "e-append", tone: "rust", count: 3, spacing: 500, dur: 900 }],
			changed: [["+", "Workspace mounted over the write commit"], ["~", "`b.txt` grows inside it"]],
			hud: { ws: `${Math.max(1, B.atKill - 1)} lines` },
			log: { host: { event: "call", tool: "bash" }, run: "run 1" },
		},
		{
			short: "SIGKILL",
			badge: "crash",
			title: "SIGKILL, two seconds in",
			body: [
				`The driver kills the host. A Workspace is left mounted on \`coder\` (\`${B.leftover}\`), with \`b.txt\` at **${B.atKill}** lines. The store has the bash call and no result.`,
			],
			set: {
				host: { state: "dead", tags: [{ text: "SIGKILL", icon: "zap", tone: "rust" }] },
				"e-drv": { label: "SIGKILL", labelTone: "rust", tone: "rust", dashed: false },
				"e-model": { tone: "muted", dashed: true },
				wsb: { lines: B.atKill },
			},
			hide: ["e-store", "e-spawn"],
			fx: [{ kind: "kill", at: "host" }],
			changed: [["bad", "host killed"], ["~", `Workspace left mounted, \`b.txt\` ${B.atKill} lines`]],
			hud: { host: { v: "killed", tone: "bad" }, ws: { v: `left · ${B.atKill} lines`, tone: "bad" } },
			log: { driver: /SIGKILL/ },
		},
		{
			short: "Orphan",
			badge: "failure",
			title: "The orphan writes into the Workspace only",
			body: [
				`As in A, SIGKILL of the host doesn't reach the command: the loop is an orphan in the Sandbox and keeps going. A second later \`b.txt\` in the Workspace has **${B.later}** lines.`,
				`On the branch, \`b.txt\` has **${B.onBranch}** lines. Nothing was committed, so nothing the orphan does can reach \`coder\`.`,
			],
			set: { shell: { tags: [{ text: "orphan", icon: "warn", tone: "rust" }], halo: "bad" }, wsb: { lines: B.later } },
			packets: [{ edge: "e-append", tone: "rust", count: 2, spacing: 500, dur: 900 }],
			changed: [["~", `Workspace \`b.txt\`: ${B.later} lines`], ["ok", `branch \`b.txt\`: ${B.onBranch} lines`]],
			hud: { ws: { v: `orphan · ${B.later} lines`, tone: "bad" }, branch: "untouched" },
			log: { note: /on the branch/ },
		},
		{
			short: "Restart",
			badge: "recovery",
			title: "Restart: bash runs again, by itself",
			body: [
				"The driver restarts the host. The Harness finds the bash call without a result — and because this bash is declared **replay-safe**, it runs the call again itself. The model is not asked and not told anything.",
				"The rerun reads the memoized base and walks the branch since it, looking for a commit whose message starts `pi-task:" + B.bash + "`. There is none: as far as the branch knows, this command never finished.",
			],
			show: ["e-look", "e-store"],
			set: {
				host: { key: 2, state: undefined, sub: "run 2", tags: [] },
				"e-drv": { label: "restart", labelTone: undefined, tone: "muted", dashed: true },
				"e-model": { tone: "muted", dashed: true },
				c1: { halo: "violet" },
			},
			packets: [{ edge: "e-look", tone: "violet", dur: 1300 }],
			changed: [["+", "host, run 2"], ["-", `no \`pi-task:${B.bash}\` commit on the branch`]],
			hud: { host: "run 2", model: "nothing yet" },
			log: { host: { event: "open" }, run: "run 2" },
		},
		{
			short: "Discard",
			badge: "technique",
			title: "Kill the orphan, discard the Workspace",
			body: [
				`The Workspace is busy — the orphan's working directory is inside it — so the unmount is refused. The tool mounts a helper Workspace in the same Sandbox, kills ${killedText} from there, and unmounts the left Workspace with discard.`,
				"The branch is exactly what it was: `a.txt`, and no `b.txt`.",
			],
			callout: ["warn", "Never force the unmount while the orphan lives: in the S0 probe that fails at detach (EBUSY) and wedges the Workspace and its Sandbox for good."],
			hide: ["shell", "ws", "wsb", "e-append", "e-mount", "e-look"],
			set: { c1: { halo: undefined } },
			changed: [["-", `killed: ${B.killed.length} processes`], ["-", `Workspace \`${B.leftover}\` discarded`], ["ok", "branch unchanged"]],
			hud: { ws: "discarded" },
		},
		{
			short: "Rerun",
			badge: "recovery",
			title: "Now a rerun is safe",
			body: [
				`Nothing of the first attempt is left, so running the command again is the same as running it once. A fresh Workspace runs the loop to the end and commits \`${commitText("B", 1, "pi-task:17 exit:0")}\`.`,
				"The model gets the command's real result, exit 0. It is never told *interrupted*.",
			],
			show: ["ws", "wsb", "shell", "e-mount", "e-spawn", "e-append", "c2", "l12", "e-commit"],
			set: {
				ws: { key: 2 },
				wsb: { key: 2, lines: 10 },
				shell: { key: 2, tags: [], halo: undefined },
				"e-model": { tone: undefined, dashed: false },
			},
			packets: [
				{ edge: "e-append", tone: "rust", count: 4, spacing: 450, dur: 900 },
				{ edge: "e-commit", tone: "green", delay: 3600, dur: 1100 },
				{ edge: "e-model", tone: "violet", delay: 4700, dur: 1100 },
			],
			changed: [["+", "Workspace 2: `b.txt`, 10 lines"], ["+", `commit \`${commitText("B", 1, "pi-task:17 exit:0")}\``]],
			hud: { ws: "10 lines → commit", model: { v: "exit 0", tone: "good" }, branch: "2 commits" },
			log: { host: { event: "result", tool: "bash" }, run: "run 2" },
		},
		{
			short: "Check",
			badge: "check",
			title: "edit, Done — and the tree matches",
			body: [
				`\`edit a.txt\` commits and the model answers *Done*. The branch's tree hashes to \`${B.tree}\`, the clean run's is \`${B.clean}\`: \`a.txt\` at version 2, \`b.txt\` with exactly ${B.final} lines.`,
				"Compare scenario A: 20 lines, and a model told its command was interrupted.",
			],
			show: ["c3", "l23"],
			hide: ["ws", "wsb", "shell", "e-append", "e-mount", "e-spawn", "e-commit"],
			set: { c3: { halo: B.tree === B.clean ? "good" : "bad" } },
			changed: [
				["ok", "bash ran again by itself; the model was never told *interrupted*"],
				["ok", "one commit per tool call: write, bash, edit"],
				["ok", "the files match the clean run"],
				["ok", "no Workspace left mounted"],
			],
			hud: { ws: "—", branch: { v: B.tree === B.clean ? "= clean" : "≠ clean", tone: B.tree === B.clean ? "good" : "bad" } },
			log: { end: true },
		},
	],
};

export const lessonC = {
	id: "c-after-commit",
	scenario: "C",
	nav: "C · Crash after the commit",
	title: "Crash After the Commit",
	subtitle: "The command finished and LayerFS committed it, then the host died before Pi Durable recorded the result. Recovery must take the commit's result, not rerun.",
	minutes: 4,
	hud: HUD_LFS,
	legend: LEGEND_LFS,
	nodes: lfsBase("C"),
	edges: lfsEdges(),
	learn: [
		[0, "Which of two stores can be ahead after a crash"],
		[2, "How the commit message carries the result"],
		[5, "Why taking the commit beats rerunning"],
	],
	steps: [
		{
			short: "Setup",
			badge: "setup",
			title: "Two stores, one step",
			body: [
				"A bash call touches two stores: LayerFS commits the Workspace, then Pi Durable commits the tool result. Between the two there is a gap, and a crash can land in it.",
				"This run arms `CRASH_AT=after-commit`, right in that gap. As in B, a clean run on branch `clean` comes first: `" + C.clean + "`.",
			],
			show: ["driver", "host", "coder", "store", "c0", "c1", "l01", "sandbox", "e-drv", "e-model", "e-store"],
			hud: { ws: "—", host: "run 1", branch: "1 commit" },
			log: { note: /clean tree/ },
		},
		{
			short: "bash",
			badge: "run",
			title: "The loop runs to the end",
			body: ["bash runs in its Workspace and exits 0. `b.txt` has all 10 lines — in the Workspace."],
			show: ["ws", "wsb", "shell", "e-mount", "e-spawn", "e-append"],
			set: { wsb: { lines: 10 } },
			packets: [{ edge: "e-append", tone: "rust", count: 4, spacing: 450, dur: 900 }],
			hud: { ws: "10 lines" },
			log: { host: { event: "call", tool: "bash" }, run: "run 1" },
		},
		{
			short: "Commit",
			badge: "run",
			title: `LayerFS commits pi-task:${C.bash}`,
			body: ["The tool commits the Workspace: `pi-task:" + C.bash + "`, then `exit:0`, then the tail of the output. The branch now has `b.txt`."],
			show: ["c2", "l12", "e-commit"],
			hide: ["e-append", "e-spawn"],
			packets: [{ edge: "e-commit", tone: "green", dur: 1100 }],
			changed: [["+", `commit \`${commitText("C", 1, "pi-task:17 exit:0")}\``]],
			hud: { branch: "2 commits" },
		},
		{
			short: "Crash",
			badge: "crash",
			title: "Exit 137 before the result entry",
			body: [
				"The process dies at the crash point, before it unmounts the Workspace and before Pi Durable commits the tool result.",
				`On the branch: ${C.atCrash}. In the store: the bash call, no result. The Workspace is still mounted, committed and clean.`,
			],
			hide: ["e-mount", "e-commit", "e-store", "shell"],
			set: {
				host: { state: "dead", tags: [{ text: "exit 137", icon: "zap", tone: "rust" }] },
				"e-model": { tone: "muted", dashed: true },
				ws: { state: "dim" },
				wsb: { state: "dim" },
				store: { tags: [{ text: "session.sqlite", pos: "right" }, { text: "bash: no result", tone: "rust", pos: "right", dy: 4 }] },
			},
			fx: [{ kind: "kill", at: "host" }],
			changed: [["bad", "host gone"], ["~", "the store is one step behind the branch"]],
			hud: { host: { v: "exit 137", tone: "bad" }, ws: "left, clean" },
			log: { host: { event: "crash" } },
		},
		{
			short: "Look",
			badge: "recovery",
			title: "Restart: the commit is there",
			body: ["On restart the Harness runs the replay-safe bash call again. Its first move is the same as in B: look for `pi-task:" + C.bash + "` on the branch since the memoized base. This time it is there."],
			show: ["e-look", "e-store"],
			set: {
				host: { key: 2, state: undefined, sub: "run 2", tags: [] },
				"e-drv": { label: "restart" },
				c2: { halo: "violet" },
			},
			packets: [{ edge: "e-look", tone: "violet", dur: 1300 }],
			hud: { host: "run 2" },
			log: { host: { event: "open" }, run: "run 2" },
		},
		{
			short: "Take it",
			badge: "recovery",
			title: "Take the result from the commit; run nothing",
			body: [
				"The result is rebuilt from the commit message — exit code " + (C.replayed.exitCode ?? 0) + " and the output tail — and the left Workspace (clean) is unmounted. Nothing reruns, so `b.txt` keeps exactly 10 lines.",
				"Rerunning here would be scenario A all over again: twenty lines.",
			],
			callout: ["key", "The commit message is the receipt. Because it names the task, a recovering process can tell *finished but unrecorded* from *never finished*."],
			hide: ["e-look", "ws", "wsb"],
			set: {
				c2: { halo: "good" },
				"e-model": { tone: undefined, dashed: false },
				store: { tags: [{ text: "session.sqlite", pos: "right" }, { text: "bash: exit 0 (from the commit)", tone: "green", pos: "right", dy: 4 }] },
			},
			packets: [{ edge: "e-model", tone: "violet", dur: 1100 }],
			changed: [["+", "result entry from the commit (`replayed: true`)"], ["-", "the left Workspace unmounted"], ["ok", "no second run"]],
			hud: { model: { v: "exit 0", tone: "good" }, ws: "—" },
			log: { host: { event: "result", tool: "bash" }, run: "run 2" },
		},
		{
			short: "Check",
			badge: "check",
			title: "One commit, one run",
			body: [`\`edit a.txt\`, *Done*. One commit for each tool call, \`b.txt\` with 10 lines, and the tree \`${C.tree}\` equals the clean run's.`],
			show: ["c3", "l23"],
			set: { c2: { halo: undefined }, c3: { halo: C.tree === C.clean ? "good" : "bad" } },
			changed: [
				["ok", `bash not run again: its result came from \`pi-task:${C.bash}\``],
				["ok", "one commit per tool call: write, bash, edit"],
				["ok", "the files match the clean run"],
				["ok", "no Workspace left mounted"],
			],
			hud: { branch: { v: C.tree === C.clean ? "= clean" : "≠ clean", tone: C.tree === C.clean ? "good" : "bad" } },
			log: { end: true },
		},
	],
};

export const lessonD = {
	id: "d-fork",
	scenario: "D",
	nav: "D · Fork onto a branch",
	title: "Fork Onto a Branch",
	subtitle: "Fork a finished conversation at an entry and let it take a different step. The fork gets its own LayerFS branch, so it can never write to its parent's.",
	minutes: 4,
	hud: [
		{ key: "conv", label: "conversations", icon: "bot" },
		{ key: "parent", label: "coder: a.txt", icon: "file" },
		{ key: "fork", label: "fork: a.txt", icon: "file" },
	],
	legend: [
		["#7fc278", "commits on coder"],
		["#9b85e0", "the fork and its commits"],
	],
	nodes: {
		...lfsBase("D"),
		fork: { kind: "block", at: [3.0, 6.6], size: [2.2, 2.2, 1.7], tone: "violet", icon: "bot", label: "fork", sub: "[alt]" },
		c2b: { kind: "cylinder", at: [11.6, 7.28], r: 0.42, h: 0.34, tone: "violet", bands: 0, tags: [{ text: commitText("D", 1, "pi-task:36 exit:0"), pos: "bottom" }] },
		c3b: { kind: "cylinder", at: [14.6, 7.28], r: 0.42, h: 0.34, tone: "violet", bands: 0, tags: [{ text: `pi-task:${D.edit} → ${D.forkA}`, pos: "bottom" }] },
	},
	edges: {
		...lfsEdges(),
		l1b: { from: "c1", to: "c2b", arrow: "none", tone: "violet", gap: 0.12, z: 0.17, bend: "yx" },
		l2b: { from: "c2b", to: "c3b", arrow: "none", tone: "violet", gap: 0.12, z: 0.17 },
		"e-fork": { from: "coder", to: "fork", dashed: true, tone: "violet", label: "fork at entry " + D.at, bend: "yx", labelAt: 0.35 },
		"e-forkfs": { from: "fork", to: "c2b", tone: "violet", label: "bash · edit", labelAt: 0.55, dy0: -0.42 },
	},
	learn: [
		[1, "What a fork copies: the transcript up to an entry"],
		[1, "Why a fork starts with no branch"],
		[2, "Which commit the fork's branch starts from"],
		[4, "Why the parent's files can't change"],
	],
	steps: [
		{
			short: "Finished run",
			badge: "setup",
			title: "A finished run",
			body: ["Start from a run that went fine: `coder` has three commits — `write a.txt`, the bash loop, and `edit a.txt` to *" + D.parentA + "*."],
			show: ["coder", "host", "store", "c0", "c1", "c2", "c3", "l01", "l12", "l23", "e-model", "e-store"],
			hud: { conv: "1", parent: D.parentA, fork: "—" },
			log: { check: /run 1 finishes/ },
		},
		{
			short: "Fork",
			badge: "technique",
			title: `Fork the conversation at entry ${D.at}`,
			body: [
				`With \`FORK_AT=${D.at}\` the host forks the conversation at entry ${D.at}, the result of \`write a.txt\`: the fork has the transcript up to there and nothing after, and it is sent \`[alt]\`.`,
				"The Branch doc is declared `fork: \"initial\"`, so the fork starts with **no branch**. Until it gets one its file tools fail cleanly: it can't write to its parent's.",
			],
			show: ["fork", "e-fork"],
			set: { fork: { tags: [{ text: "no branch yet", icon: "lock", tone: "muted" }] }, c1: { halo: "violet" } },
			hud: { conv: "2", fork: "—" },
			log: { note: /fork the conversation/ },
		},
		{
			short: "Branch",
			badge: "technique",
			title: "Give the fork its own branch",
			body: [
				"`forkWithBranch()` walks back from the fork's entry to the newest tool result that names a commit — the write's — and forks a LayerFS branch from that commit, under a fixed name: `" + D.branch + "`. It records the name in the fork's Branch doc, in the commit that creates the fork.",
				"The fork sees the files as they were at its entry: `a.txt` at *version 1*, no `b.txt`.",
			],
			show: ["l1b"],
			set: { fork: { tags: [{ text: `branch ${D.branch}`, icon: "branch", tone: "violet" }] } },
			hud: { fork: "version 1" },
			log: { host: { event: "forked" } },
		},
		{
			short: "[alt]",
			badge: "run",
			title: "The fork goes its own way",
			body: [
				"The fork's last result is the write, so the scripted model runs the bash loop next — on `" + D.branch + "`, in a Workspace of its own (`pi-task:" + D.bash + "`) — and then, told `[alt]`, edits `a.txt` to *" + D.forkA + "* (`pi-task:" + D.edit + "`).",
				"Both commits land on the fork's branch only.",
			],
			show: ["c2b", "c3b", "l2b", "e-forkfs"],
			set: { c1: { halo: undefined } },
			packets: [{ edge: "e-forkfs", tone: "violet", dur: 1300 }],
			hud: { fork: D.forkA },
			log: { host: { event: "result", tool: "edit" }, run: "fork" },
		},
		{
			short: "Check",
			badge: "check",
			title: "Two heads, one shared past",
			body: [`\`coder\` still ends at *${D.parentA}*, its head and tree unchanged; \`${D.branch}\` ends at *${D.forkA}*, with its own 10-line \`b.txt\`. The two share the write commit and nothing after it.`],
			set: { c3: { halo: "good" }, c3b: { halo: "violet" } },
			changed: [
				["ok", `the fork's \`a.txt\` = ${D.forkA}`],
				["ok", "the fork's `b.txt` built again on its branch, 10 lines"],
				["ok", "the original branch is unchanged"],
			],
			hud: { parent: { v: D.parentA, tone: "good" }, fork: { v: D.forkA, tone: "good" } },
			log: { end: true },
		},
	],
};

export const DEMO1 = [lessonA, lessonB, lessonC, lessonD];
