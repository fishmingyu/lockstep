// S0 questions (a)-(e) plus protocol checks. One process, fresh project.
//   S0_VOLUME=<new vol> LAYERFS_PROJECT=<name> s0/lfs.sh node questions.mjs [section...]
// Sections: order fs msg nochange land merge exec i426
import { LayerFS, isRefusal } from "@layerfs/agent";

const project = process.env.LAYERFS_PROJECT;
const FIXTURE = new URL("./fixture/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (tag, v) => console.log(`${String(Date.now() - t0).padStart(6)}ms ${tag} ${JSON.stringify(v)}`);
const short = (id) => (typeof id === "string" ? id.slice(0, 12) : id);
const err = (e) => ({ code: e.code, message: e.message.slice(0, 300), detail: e.detail });
async function attempt(tag, fn) {
  try { const v = await fn(); log(tag, v); return v; } catch (e) { log(`${tag} REFUSED`, isRefusal(e) ? err(e) : String(e)); return null; }
}
const commits = async (lfs, b) => (await lfs.branch.list_commits(b, 50, 0)).items.map((c) => ({ id: short(c.id), parent: short(c.parent), second: short(c.secondParent), via: c.via, message: c.message }));
const head = async (lfs, b) => (await lfs.project.list_branches(1000, 0)).items.find((x) => x.name === b)?.head ?? null;

let lfs;
try {
  lfs = await LayerFS.init(project, FIXTURE);
  log("init", lfs.created);
} catch (e) {
  if (!isRefusal(e, "Exists")) throw e;
  lfs = await LayerFS.open(project);
}
const only = process.argv.slice(2);
const want = (s) => !only.length || only.includes(s);
let sandbox = null;
async function sb() {
  if (sandbox) return sandbox;
  sandbox = (await lfs.sandbox.create()).sandbox;
  await sleep(1500);
  return sandbox;
}
async function step(branch, cmd, message) {
  const ws = await lfs.workspace.mount(await sb(), branch);
  try {
    const r = await lfs.workspace.exec(ws, cmd);
    const c = await lfs.workspace.commit(ws, message ?? `exec: ${cmd}`);
    return { exec: { kind: r.kind, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }, commit: { kind: c.kind, head: short(c.head), merged: c.merged, message: c.commit?.message } };
  } finally {
    await lfs.workspace.unmount(ws, true);
  }
}

try {
  if (want("order")) {
    console.log("\n=== (a) list_commits order");
    await lfs.branch.fork("qa");
    for (const n of [1, 2, 3]) await lfs.fs.write("qa", `/f${n}.txt`, `${n}\n`, `m${n}`);
    log("list_commits(qa)", await commits(lfs, "qa"));
    log("page(1,0) vs page(1,1)", [(await lfs.branch.list_commits("qa", 1, 0)).items[0].message, (await lfs.branch.list_commits("qa", 1, 1)).items[0].message]);
    log("head via list_branches == list_commits[0].id", (await head(lfs, "qa")) === (await lfs.branch.list_commits("qa", 1, 0)).items[0].id);
    await attempt("list_commits(main)", () => lfs.branch.list_commits("main"));
    log("raw commit record keys", Object.keys((await lfs.branch.list_commits("qa", 1, 0)).items[0]));
  }

  if (want("fs")) {
    console.log("\n=== (d) fs.write / fs.edit -> one commit each");
    await lfs.branch.fork("qd");
    const h0 = (await lfs.branch.list_commits("qd", 50, 0)).items.length;
    const w = await lfs.fs.write("qd", "/w.txt", "alpha\nbeta\n", "pi-task:fs1\nwrite w.txt");
    log("fs.write", { kind: w.kind, branch: w.branch, head: short(w.head), commitKeys: Object.keys(w.commit ?? {}), message: w.commit?.message });
    const e = await lfs.fs.edit("qd", "/w.txt", "beta", "gamma", "pi-task:fs2\nedit w.txt");
    log("fs.edit", { kind: e.kind, head: short(e.head), message: e.commit?.message });
    log("commits added", (await lfs.branch.list_commits("qd", 50, 0)).items.length - h0);
    log("list_commits(qd)", await commits(lfs, "qd"));
    await attempt("fs.write same content", () => lfs.fs.write("qd", "/w.txt", "alpha\ngamma\n", "noop write"));
    await attempt("fs.edit NoMatch", () => lfs.fs.edit("qd", "/w.txt", "zzz", "y", "bad edit"));
    await attempt("fs.write without message", async () => (await lfs.fs.write("qd", "/n.txt", "x\n")).commit.message);
    await attempt("fs.write to main", () => lfs.fs.write("main", "/x.txt", "x"));
    await attempt("fs.write into missing dir", () => lfs.fs.write("qd", "/no/such/x.txt", "x"));
    await attempt("fs.read", async () => (await lfs.fs.read("qd", "/w.txt")));
    const big = "y".repeat(200_000);
    await attempt("fs.write 200 KB", async () => (await lfs.fs.write("qd", "/big.txt", big, "big")).kind);
    log("commits total", (await lfs.branch.list_commits("qd", 50, 0)).items.length - h0);
  }

  if (want("msg")) {
    console.log("\n=== (d) custom workspace commit message round trip + message rules");
    await lfs.branch.fork("qm");
    const msg = "pi-task:abc-123\nexit:2\nsome output\n\ttabbed line\nünïcödé ✓";
    const s = await step("qm", "echo out > out.txt; exit 2", msg);
    log("step", s);
    const top = (await lfs.branch.list_commits("qm", 1, 0)).items[0];
    log("message read back identical", top.message === msg);
    log("commit via", top.via);
    const ws = await lfs.workspace.mount(await sb(), "qm");
    try {
      await lfs.workspace.exec(ws, "echo again >> out.txt");
      await attempt("commit msg with ESC", () => lfs.workspace.commit(ws, "pi-task:x\n\x1b[31mred\x1b[0m"));
      await attempt("commit msg with CR", () => lfs.workspace.commit(ws, "pi-task:x\r\nexit:0"));
      await attempt("commit msg 4097 bytes", () => lfs.workspace.commit(ws, "pi-task:x\n" + "a".repeat(4087)));
      const ok = await attempt("commit msg exactly 4096 bytes", async () => (await lfs.workspace.commit(ws, "pi-task:x\n" + "a".repeat(4086))).kind);
      log("4096-byte message read back length", Buffer.byteLength((await lfs.branch.list_commits("qm", 1, 0)).items[0].message));
    } finally {
      await lfs.workspace.unmount(ws, true);
    }
  }

  if (want("nochange")) {
    console.log("\n=== (c) commit after a command that changed nothing");
    await lfs.branch.fork("qc");
    await lfs.fs.write("qc", "/keep.txt", "same\n", "seed");
    const before = await head(lfs, "qc");
    log("true", await step("qc", "true", "pi-task:c1\nexit:0\n"));
    log("cat only", await step("qc", "cat keep.txt", "pi-task:c2\nexit:0\nsame"));
    log("exit 1, no writes", await step("qc", "ls nope", "pi-task:c3\nexit:2\n"));
    log("rewrite identical bytes", await step("qc", "printf 'same\\n' > keep.txt", "pi-task:c4"));
    log("touch (mtime only)", await step("qc", "touch keep.txt", "pi-task:c5"));
    log("create+delete tmp file", await step("qc", "echo x > t; rm t", "pi-task:c6"));
    log("write to /tmp only", await step("qc", "echo x > /tmp/scratch", "pi-task:c7"));
    log("commits after seed", (await commits(lfs, "qc")).map((c) => c.message));
    log("head moved", before !== (await head(lfs, "qc")));
  }

  if (want("land")) {
    console.log("\n=== (b) land: publish directly vs merge main in then publish");
    await lfs.branch.fork("la");
    await lfs.branch.fork("lb");
    const mainBase0 = (await lfs.project.list_branches()).items.find((b) => b.name === "main").base;
    await lfs.fs.write("la", "/a.txt", "from a\n", "a");
    await lfs.fs.write("lb", "/b.txt", "from b\n", "b");
    await attempt("publish(la)", () => lfs.branch.publish("la"));
    await attempt("main has a.txt", async () => (await lfs.fs.read("main", "/a.txt")).text);
    await attempt("publish(la) again", () => lfs.branch.publish("la"));
    await attempt("publish(lb) directly (stale: forked before la landed)", () => lfs.branch.publish("lb"));
    await attempt("main has a.txt after stale publish", async () => (await lfs.fs.read("main", "/a.txt")).text);
    await attempt("main has b.txt", async () => (await lfs.fs.read("main", "/b.txt")).text);
    log("main entry", (await lfs.project.list_branches()).items.find((b) => b.name === "main"));
    // the safe way
    await lfs.fs.write("la", "/a2.txt", "a2\n", "a2");
    await attempt("merge(la, main, la-land)", async () => { const m = await lfs.branch.merge("la", "main", "la-land", "merge main in"); return { ...m, head: short(m.head) }; });
    await attempt("publish(la-land)", () => lfs.branch.publish("la-land"));
    for (const p of ["/a.txt", "/a2.txt", "/b.txt"]) await attempt(`main ${p}`, async () => (await lfs.fs.read("main", p)).text);
    await attempt("merge into name 'main'", () => lfs.branch.merge("la", "lb", "main"));
    await attempt("mount main", async () => lfs.workspace.mount(await sb(), "main"));
    await attempt("fork(la) again (NameTaken)", () => lfs.branch.fork("la"));
    log("la-land history", await commits(lfs, "la-land"));
    await attempt("publish branch with no commit", async () => { await lfs.branch.fork("empty"); return lfs.branch.publish("empty"); });
    log("main base changed", mainBase0 !== (await lfs.project.list_branches()).items.find((b) => b.name === "main").base);
  }

  if (want("merge")) {
    console.log("\n=== workspace.commit after the Branch moved since mount");
    await lfs.branch.fork("qw");
    await lfs.fs.write("qw", "/base.txt", "1\n", "seed");
    const ws = await lfs.workspace.mount(await sb(), "qw");
    try {
      await lfs.fs.write("qw", "/other.txt", "moved\n", "pi-task:other\nexit:0\n");
      const st = (await lfs.sandbox.list_workspaces(ws.sandbox, 100, 0)).items.find((w) => w.path === ws.path);
      log("list_workspaces entry after head moved", st);
      await lfs.workspace.exec(ws, "echo mine > mine.txt");
      const c = await lfs.workspace.commit(ws, "pi-task:mine\nexit:0\n");
      log("commit", { kind: c.kind, merged: c.merged, parent: short(c.commit.parent), second: short(c.commit.secondParent), message: c.commit.message });
      log("history", await commits(lfs, "qw"));
      await lfs.workspace.exec(ws, "echo 2 > base.txt");
      await lfs.fs.write("qw", "/base.txt", "3\n", "conflicting fs write");
      await attempt("conflicting commit", () => lfs.workspace.commit(ws, "pi-task:conf"));
    } finally {
      await attempt("unmount(discard) after conflict", () => lfs.workspace.unmount(ws, true));
    }
  }

  if (want("exec")) {
    console.log("\n=== exec result shape");
    await lfs.branch.fork("qe");
    const ws = await lfs.workspace.mount(await sb(), "qe");
    try {
      log("env", await lfs.workspace.exec(ws, "id; pwd; echo HOME=$HOME; echo err >&2; exit 3", "shape"));
      log("signal", await lfs.workspace.exec(ws, "kill -9 $$"));
      log("bg job holds exec until it ends (2s)", await (async () => { const s = Date.now(); const r = await lfs.workspace.exec(ws, "(sleep 2; echo bg) & echo fg"); return { ms: Date.now() - s, stdout: r.stdout }; })());
      log("bg job detached from output (returns at once)", await (async () => { const s = Date.now(); const r = await lfs.workspace.exec(ws, "(sleep 2 >/dev/null 2>&1 &) ; echo fg"); return { ms: Date.now() - s, stdout: r.stdout }; })());
      await sleep(2100);
    } finally {
      await lfs.workspace.unmount(ws, true);
    }
  }

  if (want("i426")) {
    console.log("\n=== (e) #426: mount right after sandbox.create, with and without a 1.5 s wait");
    await lfs.branch.fork("qi");
    for (const wait of [0, 0, 0, 1500, 1500, 1500]) {
      const s = Date.now();
      const { sandbox: n } = await lfs.sandbox.create();
      const created = Date.now() - s;
      await sleep(wait);
      const ws = await lfs.workspace.mount(n, "qi");
      const mountedAt = Date.now() - s;
      const r = await lfs.workspace.exec(ws, `echo ${n} >> f.txt`);
      const c = await lfs.workspace.commit(ws, `i426 wait=${wait}`);
      await sleep(1200); // the issue's trigger: the early Workspace lives > ~1 s
      const u0 = Date.now();
      const u = await attempt(`  wait=${wait} sandbox ${n} (created ${created}ms, mounted at ${mountedAt}ms) unmount`, () => lfs.workspace.unmount(ws));
      log(`  unmount took`, Date.now() - u0);
      if (u) await attempt(`  sandbox.close ${n}`, () => lfs.sandbox.close(n));
      // early mount with discard and no commit, as in the issue
      const { sandbox: m } = await lfs.sandbox.create();
      await sleep(wait);
      const ws2 = await lfs.workspace.mount(m, "qi");
      await lfs.workspace.exec(ws2, "echo x > y.txt");
      await sleep(1500);
      const u1 = Date.now();
      const v = await attempt(`  wait=${wait} sandbox ${m} discard-unmount`, () => lfs.workspace.unmount(ws2, true));
      log(`  unmount took`, Date.now() - u1);
      if (v) await attempt(`  sandbox.close ${m}`, () => lfs.sandbox.close(m));
    }
  }
} finally {
  if (sandbox) {
    for (const w of (await lfs.sandbox.list_workspaces(sandbox, 100, 0)).items) await attempt("leftover unmount", () => lfs.workspace.unmount({ sandbox: w.sandbox, path: w.path }, true));
    await attempt("sandbox.close", () => lfs.sandbox.close(sandbox));
  }
  log("sandboxes left", (await lfs.project.list_sandboxes()).items);
  await lfs.close();
}
