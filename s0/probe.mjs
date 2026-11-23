// S0 probe, steps 2-4: init -> fork -> sandbox create -> mount -> long exec,
// SIGKILL the caller mid-exec, then recover from a fresh process.
//
// Each subcommand is meant to run as its own process inside a LayerFS client
// container (see lfs.sh); probe.sh drives the whole sequence.
//
//   node probe.mjs setup                      init (or open) project, fork "probe", create a Sandbox
//   node probe.mjs run <sandbox> <taskId> <n> mount, exec an n x 0.5s loop, commit pi-task:<taskId>, unmount
//   node probe.mjs recover <sandbox> <taskId> look for a pi-task:<taskId> commit since base, else
//                                             list + discard leftover Workspaces (force if Busy)
//   node probe.mjs cleanup                    discard all Workspaces, close all Sandboxes
import { LayerFS, isRefusal } from "@layerfs/agent";

const BRANCH = process.env.S0_BRANCH ?? "probe";
const FIXTURE = new URL("./fixture/", import.meta.url).pathname;
const project = process.env.LAYERFS_PROJECT;
const t0 = Date.now();
const log = (tag, value) => console.log(`${String(Date.now() - t0).padStart(6)}ms ${tag} ${JSON.stringify(value)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errOf = (e) => ({ code: e.code, message: e.message, detail: e.detail });

const [step, ...args] = process.argv.slice(2);

// Init first, open on Exists. (open() on a fresh volume, whose Store file does not
// exist yet, fails `Failed: Os { code: 2, NotFound }`, not NoSuchProject.)
async function openOrInit() {
  try {
    const lfs = await LayerFS.init(project, FIXTURE);
    log("init", lfs.created);
    return lfs;
  } catch (e) {
    if (!isRefusal(e, "Exists")) throw e;
    return LayerFS.open(project);
  }
}

/** Protocol commit message: pi-task:<taskId>\nexit:<code>\n<output tail>, made legal. */
function taskMessage(taskId, exitCode, output) {
  // SDK refuses C0 controls except \n \t, DEL/C1, lone surrogates, > 4096 bytes.
  const clean = output.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/[\ud800-\udfff]/g, "�");
  const head = `pi-task:${taskId}\nexit:${exitCode}\n`;
  let tail = clean.slice(-2000);
  while (Buffer.byteLength(head + tail) > 4096) tail = tail.slice(Math.ceil(tail.length / 8));
  return head + tail;
}

/** Newest-first walk of the Branch's first-parent history back to (excluding) its fork base. */
async function findTaskCommit(lfs, taskId) {
  const want = `pi-task:${taskId}\n`;
  for (let pos = 0; ; ) {
    const page = await lfs.branch.list_commits(BRANCH, 100, pos);
    for (const c of page.items) if (c.message?.startsWith(want)) return c;
    if (!page.hasMore) return null;
    pos += page.items.length;
  }
}

/** SIGKILL every process in the Sandbox whose cwd or an open fd is inside `ws.path`,
 * from a helper Workspace (same container, same PID namespace). Pure SDK. */
async function killOrphans(lfs, ws) {
  const helper = await lfs.workspace.mount(ws.sandbox, BRANCH);
  try {
    const script = `p='${ws.path}'; for d in /proc/[0-9]*; do pid=\${d#/proc/}; [ "$pid" = "$$" ] && continue;
      c=$(readlink "$d/cwd" 2>/dev/null); hit=; case "$c" in "$p"|"$p"/*) hit=1;; esac
      [ -z "$hit" ] && ls -l "$d/fd" 2>/dev/null | grep -q -- "-> $p/" && hit=1
      [ -n "$hit" ] && { cmd=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null); kill -9 "$pid" 2>/dev/null && echo "killed $pid $cmd"; }; done; true`;
    const r = await lfs.workspace.exec(helper, script, "kill orphans");
    log("killOrphans", { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr });
  } finally {
    await lfs.workspace.unmount(helper, true);
  }
}

const steps = {
  async setup() {
    const lfs = await openOrInit();
    try {
      try {
        log("fork", await lfs.branch.fork(BRANCH));
      } catch (e) {
        if (!isRefusal(e, "NameTaken")) throw e;
        log("fork", "exists");
      }
      const created = await lfs.sandbox.create();
      log("sandbox.create", created);
      await sleep(1500); // pi-layerfs's #426 guard: mount only once the Sandbox is 1.5 s old
      const branches = await lfs.project.list_branches();
      log("branch", branches.items.find((b) => b.name === BRANCH));
      console.log(`SANDBOX=${created.sandbox}`);
    } finally {
      await lfs.close();
    }
  },

  async run(sandbox, taskId, n = "10") {
    const lfs = await LayerFS.open(project);
    const ws = await lfs.workspace.mount(sandbox, BRANCH);
    log("mount", ws);
    console.log(`WS=${ws.sandbox}:${ws.path}`);
    try {
      // appends a line AND creates one new file per iteration, so the changed set visibly grows
      const cmd = `for i in $(seq 1 ${Number(n)}); do echo "task ${taskId} line $i" | tee -a progress.txt; : > step-$i.txt; sleep 0.5; done`;
      const r = await lfs.workspace.exec(ws, cmd, `pi-task:${taskId}`);
      log("exec", { kind: r.kind, exitCode: r.exitCode, stdoutTail: r.stdout.slice(-60), stderr: r.stderr });
      const c = await lfs.workspace.commit(ws, taskMessage(taskId, r.exitCode, r.stdout + r.stderr));
      log("commit", { kind: c.kind, head: c.head, message: c.commit?.message });
    } finally {
      log("unmount", await lfs.workspace.unmount(ws));
      await lfs.close();
    }
  },

  async recover(sandbox, taskId) {
    const lfs = await LayerFS.open(project);
    try {
      const branch = (await lfs.project.list_branches()).items.find((b) => b.name === BRANCH);
      log("branch", branch);
      const hit = await findTaskCommit(lfs, taskId);
      log("taskCommit", hit ? { id: hit.id, message: hit.message } : null);
      const page = await lfs.sandbox.list_workspaces(sandbox, 100, 0);
      log("list_workspaces", page.items);
      // (g) is the killed caller's command still running and still changing the Workspace?
      for (const w of page.items.filter((w) => w.branch === BRANCH)) {
        const ws = { sandbox: w.sandbox, path: w.path };
        for (const t of [0, 1]) {
          if (t) await sleep(1000);
          const now = (await lfs.sandbox.list_workspaces(sandbox, 100, 0)).items.find((x) => x.path === w.path);
          let changed = null;
          try { await lfs.workspace.unmount(ws); } catch (e) { changed = errOf(e); } // no discard: Dirty lists paths
          log(`sample ${t}: dirty / plain-unmount refusal`, { dirty: now?.dirty, activity: now?.activity, refusal: changed });
        }
      }
      for (const w of page.items.filter((w) => w.branch === BRANCH)) {
        const ws = { sandbox: w.sandbox, path: w.path };
        for (let attempt = 1; ; attempt++) {
          try {
            log(`unmount(discard) #${attempt}`, await lfs.workspace.unmount(ws, true));
            break;
          } catch (e) {
            log(`unmount(discard) #${attempt} refused`, errOf(e));
            if (!isRefusal(e, "Busy") || attempt === 5) throw e;
            // The killed caller's command is still running in the Sandbox: SIGKILL of
            // the caller does not stop a docker exec, and its cwd keeps the FUSE mount
            // busy. Do NOT use force here: force while the orphan is alive fails at
            // Detach (EBUSY) and wedges the Workspace and its Sandbox for good.
            // Kill the orphan from a helper Workspace in the same Sandbox instead.
            await killOrphans(lfs, ws);
            await sleep(200);
          }
        }
      }
      log("list_workspaces after", (await lfs.sandbox.list_workspaces(sandbox, 100, 0)).items);
      const after = (await lfs.project.list_branches()).items.find((b) => b.name === BRANCH);
      log("branch head unchanged", after.head === branch.head);
      console.log(`RECOVERED=${hit ? "found-commit" : "discarded-rerun-needed"}`);
    } finally {
      await lfs.close();
    }
  },

  async cleanup() {
    const lfs = await LayerFS.open(project);
    try {
      for (const { sandbox } of (await lfs.project.list_sandboxes(100, 0)).items) {
        for (const w of (await lfs.sandbox.list_workspaces(sandbox, 100, 0)).items) {
          const ws = { sandbox: w.sandbox, path: w.path };
          try { log("unmount", await lfs.workspace.unmount(ws, true)); }
          catch (e) { log("unmount refused", errOf(e)); log("force", await lfs.workspace.unmount(ws, true, true)); }
        }
        log("sandbox.close", await lfs.sandbox.close(sandbox));
      }
    } finally {
      await lfs.close();
    }
  },
};

if (!steps[step]) {
  console.error("usage: node probe.mjs setup | run <sandbox> <taskId> <n> | recover <sandbox> <taskId> | cleanup");
  process.exit(2);
}
try {
  await steps[step](...args);
} catch (e) {
  log("ERROR", e.code ? errOf(e) : String(e.stack ?? e));
  process.exit(1);
}
