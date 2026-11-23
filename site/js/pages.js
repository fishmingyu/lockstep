// The two text pages: how to run the demos (with the recorded results), and a glossary.
import { icon } from "./iso.js";
import { TRACES } from "./trace.js";
import { esc, md } from "./util.js";

const COMMANDS = [
	["git clone --recurse-submodules \\\n  <this repo> && npm run setup", "Fetch the two submodules at their pinned commits (Pi Durable 1f6f319 in `vendor/pi`, LayerFS 7d42d0b in `vendor/layerfs`), build Pi, build LayerFS's daemon and Node addon in `rust:1.85.1-bookworm`, build the Sandbox image (`docker/sandbox.Dockerfile`: Debian, python3, pytest), and install. Needs Node 22 and Docker; safe to run again."],
	["npm run setup:lfs", "Rebuild only the Sandbox image."],
	["npm run demo1", "Demo 1, A–D (or `npm run demo1 -- B` for one). A runs here; B–D each run in a LayerFS client container with a fresh project."],
	["npm run demo2", "Demo 2, E–I on LayerFS branches, each in its own client container (`npm run demo2 -- I` for one)."],
	["npm run demo2:dir", "The control group: E–I with workers in plain directories, on this machine, no LayerFS. Needs `python3` with pytest, and `rsync`. Its traces are E-dir … I-dir."],
	["RUN_DIR=runs/demo2-G-dir \\\n  npm run approve", "List pending approvals in a run directory; `npm run approve -- <id> yes` answers one."],
	["npm run site:bake", "Copy the traces the last runs wrote (`runs/traces/*.json`) into the site."],
	["npm run site", "Serve this site on http://localhost:5173."],
];

const SCENARIOS = [
	["A", "a-control", "Kill bash 2 s in, plain directory"],
	["B", "b-layerfs-kill", "Same kill on LayerFS"],
	["C", "c-after-commit", "Crash after the LayerFS commit"],
	["D", "d-fork", "Fork onto its own branch"],
	["E", "e-twice", "The same event delivered twice"],
	["F", "f-crash-spawn", "Crash right after the second spawn"],
	["G", "g-crash-approval", "Crash while land waits for approval"],
	["H", "h-full-run", "A full run"],
	["I", "i-kill-worker", "Kill the host while worker a's bash runs"],
	["E-dir", "e-twice", "E on plain directories (control)"],
	["F-dir", "f-crash-spawn", "F on plain directories (control)"],
	["G-dir", "g-crash-approval", "G on plain directories (control)"],
	["H-dir", "h-full-run", "H on plain directories (control)"],
	["I-dir", "i-kill-worker", "I on plain directories (control)"],
];

export function RunPage() {
	const rows = SCENARIOS.map(([id, lesson, title]) => {
		const t = TRACES[id];
		if (!t)
			return `<tr><td>${id}</td><td><a href="#/learn/${lesson}">${esc(title)}</a></td><td><span class="fail" style="color:var(--yellow-ink)">not run</span></td><td>—</td></tr>`;
		const checks = t.trace.filter((e) => e.kind === "check");
		return `<tr><td>${id}</td><td><a href="#/learn/${lesson}">${esc(t.title)}</a><div style="color:var(--muted);font-size:11px;margin-top:4px">expected: ${esc(t.expected)}</div></td><td>${t.passed ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'}<div style="color:var(--muted-2);font-size:10.5px">${esc(t.recordedAt.slice(0, 16).replace("T", " "))}</div></td><td><ul>${checks.map((c) => `<li><span class="${c.ok ? "pass" : "fail"}">${c.ok ? "✓" : "✗"}</span> ${esc(c.label)}</li>`).join("")}</ul></td></tr>`;
	}).join("");
	return `<div class="page">
		<h1>Run it</h1>
		<p class="lede">Every lesson with a <b>recorded run</b> tag replays a real run of its scenario. Run the demos, bake the traces, reload.</p>
		<h2>Commands</h2>
		<div class="cmds">${COMMANDS.map(([cmd, text]) => `<div class="card cmd"><code>${esc(cmd)}</code><p>${md(text)}</p></div>`).join("")}</div>
		<h2>How a scenario works</h2>
		<p>The driver (<code>demo1/scenarios.ts</code>, <code>demo2/scenarios.ts</code>) starts the host as a child process in a fresh run directory under <code>runs/</code> and reads the <code>@ {…}</code> event lines it prints. It kills the host with SIGKILL when the scenario says, or sets <code>CRASH_AT=&lt;point&gt;</code> so the host exits with 137 once at that point, restarts it on the same directory, and finally checks the store (read-only) and the files. Everything it prints is also written to <code>runs/traces/&lt;scenario&gt;.json</code>.</p>
		<p>LayerFS's SDK opens the project's Store in its own process, and the Store lives in a Docker volume only root can reach, so a LayerFS scenario runs its driver, and the hosts it starts, as root in a client container (<code>shared/container.ts</code>), with a fresh project and volume (<code>lockstep-lfs-&lt;project&gt;</code>) each. Commands run in Sandbox containers the SDK starts.</p>
		<h2>Recorded results</h2>
		<div class="card" style="padding:4px 10px"><table class="runs"><thead><tr><th></th><th>Scenario</th><th>Result</th><th>Checks</th></tr></thead><tbody>${rows}</tbody></table></div>
	</div>`;
}

const TERMS = [
	["Harness", "Pi Durable's runtime. It opens the SQLite store, runs conversations, and after a restart resumes whatever was unfinished.", "Harness.open · harness.resume()"],
	["Entry", "One step of a conversation — a model reply or a tool result — committed to the store before the next step runs.", "session.sqlite"],
	["Submission · request ID", "Work handed to a conversation. Submitting with a request ID that was used before returns the earlier submission, in this process or a later one: the outbox.", "conversation.submit({ requestId })"],
	["Replay-safe tool", "A tool declared `replay: \"safe\"` may be run again after a crash, because a second run ends in the same state as one. `spawn_worker`, `wait_workers`, `land` and the four LayerFS tools are; Pi's own bash isn't, so a cut-off call of it is reported to the model as *interrupted*.", "defineTool({ replay })"],
	["Doc", "Typed state that belongs to a conversation and is committed with it: Workers (the router's workers), Workdir (a conversation's directory), Branch (its LayerFS branch). `fork: \"initial\"` means a fork starts from the initial value, not the parent's.", "defineDoc"],
	["Signal", "A keyed value a sleeping task waits for. A key takes one value: delivering it again answers `duplicate`, and the first value stands.", "defineSignal · harness.signal"],
	["beforeTool hook", "Runs before every tool call. The policy uses it to block a call or park it on a signal with a deadline; `api.memo` keeps that deadline fixed across wakes and restarts.", "demo2/policy.ts"],
	["Admission", "A pure function of an incoming event — labels, author — run before anything is submitted. No model is asked.", "demo2/admission.ts"],
	["Worker", "A child conversation the router creates with `spawn_worker`, on its own LayerFS branch forked from main (`worker-<name>-<taskId>`), with the LayerFS tools. An anchor task owns it, so it outlives the call that made it. In the control group: a copy of `main/` and Pi's CodingTools.", "demo2/router.ts · demo2/workspaces.ts"],
	["land", "Merges the worker's branch with main into `land-<branch>` and publishes that: publishing a stale branch directly would drop what main gained since its fork. Always needs approval. In the control group: `rsync --delete --checksum`.", "demo2/workspaces.ts"],
	["LayerFS tools", "read, write, edit and bash on the conversation's branch (its Branch doc). write and edit are one commit each; bash runs in a Workspace that is committed when the command ends, also when it fails. All four are replay-safe through the commit protocol.", "demo1/tools.ts"],
	["Crash point", "`CRASH_AT=<name>` makes the host exit with 137 the first time it reaches `crashPoint(name)`. A marker file lets the restarted host pass it.", "shared/crash.ts"],
	["Orphan", "A command that keeps running after the process that started it was killed. SIGKILL of the host doesn't reach its shell, on the host (A) or in a Sandbox (B, I). On LayerFS it writes into a Workspace no one will commit, and the rerun kills it.", "scenarios A, B, I"],
	["Tree hash", "sha256 over a tree's sorted (path, content) pairs: a directory, or a branch read through the SDK. Crash runs are compared against a clean run's tree hash.", "demo1/scenarios.ts"],
	["Branch · Workspace · Sandbox", "LayerFS keeps committed history on branches. A Workspace is a writable layer mounted over a branch head inside a Sandbox (a container); its changes reach the branch only when committed, and can be discarded whole.", "vendor/layerfs"],
	["pi-task commit", "The commit a tool call leaves on its branch: `pi-task:<taskId>`, then for bash `exit:<code>` and the output tail. A rerun looks for it before doing anything else: found, the call finished and its result is in the message; not found, discard what is left and run.", "demo1/tools.ts · shared/lfs.ts"],
	["Client container", "Where everything that talks to LayerFS runs: root, with the project's Store volume, the Docker socket and the repository mounted. One project, and one volume, per scenario.", "shared/container.ts"],
];

export function GlossaryPage() {
	return `<div class="page">
		<h1>Glossary</h1>
		<p class="lede">The words the lessons use, and where each lives in the code.</p>
		<div class="terms">${TERMS.map(([term, text, where]) => `<div class="card term"><h3>${esc(term)}</h3><p>${md(text)}</p><small>${icon("file", "i")} ${esc(where)}</small></div>`).join("")}</div>
	</div>`;
}
