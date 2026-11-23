# lockstep

Crash-safe agent tool calls. Pi Durable keeps the conversation, LayerFS keeps the files, and a commit protocol keeps the two in step.

There are two demos, written in TypeScript on [Pi Durable](https://github.com/earendil-works/pi) (`packages/durable`):

- **Demo 2, orchestration** (`demo2/`): a minimal superagent. An issue event is admitted and handed to a router conversation. The router spawns two workers that each try a fix, waits for their tests, and lands the one that passed once a person approves.
- **Demo 1, execution** (`demo1/`): read, write, edit and bash tools on a [LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs) branch. Each tool call that changes files makes one commit tagged with its task ID.

Demo 2's workers use Demo 1's tools, each worker on its own branch.

Every claim below is backed by a scenario. Each scenario kills the host process at a chosen point, restarts it, and then checks the Pi store and the files. The model is Pi's faux provider driven by a script (`shared/script.ts`), so every run takes the same steps. `npm run site` replays the recorded runs step by step at http://localhost:5173.

## Two layers

```text
   issue event
     |  admit(event): a pure function, no model
     |  router.submit({ requestId: "event:<id>" })
+----|-- Orchestration: Pi Durable --------------------------------------------------+
|    v                                                                               |
|  router conversation  -- spawn_worker -->  worker a, worker b                      |
|    tools: spawn_worker, wait_workers,      child conversations of the router       |
|           land                             tools: read, write, edit, bash          |
|    policy: land and risky bash wait                                                |
|            for a person to approve                                                 |
|                                                                                    |
|  One SQLite store. Each tool call is a task with an ID; after a crash the          |
|  Harness runs every unfinished replay-safe call again.                             |
+-----------------------------+-----------------------------+------------------------+
                              |                             |
     land: merge the worker   |                             |  each file change: one
     branch with main, then   |                             |  commit whose message
     publish the merge        |                             |  starts pi-task:<taskId>
                              v                             v
+-- Execution: LayerFS -------+-----------------------------+------------------------+
|                                                                                    |
|  worker-a-12 --+                                                                   |
|                +-- merge --> land-worker-a-12 -- publish --> main                  |
|  main ---------+                                                                   |
|  worker-b-31: kept, not merged                                                     |
|                                                                                    |
|  bash: mount a Workspace of the branch in a Sandbox container, exec,               |
|        commit, unmount. A killed run leaves its Workspace mounted, and its         |
|        orphaned command keeps writing, but only there.                             |
+------------------------------------------------------------------------------------+
```

Pi Durable keeps everything in one SQLite store. After a crash, the Harness runs an unfinished call again if its tool declares `replay: "safe"`. That declaration is only a promise: the tool itself has to make a second run end where a single run would. The commit protocol below is how read, write, edit and bash keep that promise.

## superagent on Pi Durable

| superagent | Here | Code | Shown by |
|---|---|---|---|
| Event dedup (outbox) | `submit` with `requestId: "event:<id>"`. Delivering the same event again returns the submission the first delivery made. | `demo2/intake.ts` | E |
| Deterministic admission | A pure function of the event (needs the `agent` label and an allowed author), run before anything is submitted. No model is asked. | `demo2/admission.ts` | E |
| Router session | The Harness's root conversation, with the router extension: `spawn_worker`, `wait_workers`, `land`. | `demo2/harness.ts`, `demo2/router.ts` | H |
| Worker | A child conversation, created in the same store commit that records it in the router's Workers doc. It is owned by a background anchor task, so it outlives the call that made it (example 22). It is configured without the router extension, so it cannot spawn workers or land. | `demo2/router.ts` | F, H |
| Dispatch exactly once | The worker's submission has `requestId: "spawn:<taskId>:<name>"`. A rerun of `spawn_worker` finds the worker in the doc and the submission by its request ID. | `demo2/router.ts` | F |
| Waiting for workers | `wait_workers` submits the same request again, gets the existing submission back, and waits for it to settle. Each worker's last test exit code is read from its transcript. | `demo2/router.ts` | H |
| Crash recovery | Built in: reopen the Harness on the same store, and unfinished replay-safe calls run again. | `demo2/host.ts` | F, I |
| Mandate | A `beforeTool` hook. `land` always needs approval, and so does any bash command matching `git push` or `rm -rf`. The call parks on a signal keyed by a digest of its arguments, with a deadline memoized at the first pass (example 44). | `demo2/policy.ts` | G |
| Human approval | `npm run approve -- <id> yes` writes an answer file. The host turns it into `harness.signal` and moves the file to `done/`. If a crash makes it signal again, the answer is `duplicate` and the first value stands. | `demo2/approvals.ts`, `demo2/approve.ts` | G |
| Worker workspace | A LayerFS branch, `worker-<name>-<taskId>`, forked from main and recorded in the worker's Branch doc. | `demo2/workspaces.ts` | H |
| Landing | Merge the worker's branch with main into `land-<branch>`, then publish that. A rerun finds the merge already made (`NameTaken`), and publishing it again changes nothing. | `demo2/workspaces.ts` | G, I |

Much of a superagent's complexity is durable execution built again by hand. Here, dispatching once, recovering, waiting, and approvals that survive restarts all come from Pi Durable. What is left in `demo2/` is about 500 lines of code, not counting comments, blank lines or the scenarios.

## The bash commit protocol

`demo1/tools.ts` runs these steps on every call. A rerun after a crash runs the same steps:

```text
base = memo("lfs.base", head(branch))     the first run stores it; a rerun reads the same value
done = the commit since base whose message starts "pi-task:<taskId>\n"
if done:  unmount the Workspace it left (committed, so clean); return exit code and output from the message
discard leftovers on the branch: unmount and discard each Workspace; while that is Busy, kill its orphaned processes
ws = mount(branch) in the Sandbox;  r = exec(ws, command)
commit(ws, "pi-task:<taskId>\nexit:<code>\n<output tail>")     also when the command fails; at most 4096 bytes
unmount(ws)
```

The output is stored in the commit, so recovery reads only LayerFS. There is nothing to line up across the two stores.

| The run died | A rerun finds | So it | Scenario |
|---|---|---|---|
| before memoizing the base | nothing | runs as a first run would | |
| during exec, or between exec and commit | a Workspace still mounted on the branch, and no commit with this task ID; the orphaned command may still be writing into that Workspace | kills the orphan, discards the Workspace, and runs the command again | B, I |
| after the commit, before the tool result reached the Pi store | a commit with this task ID, its Workspace still mounted and clean | does not run the command: unmounts, and returns the exit code and output from the commit message | C |
| after a command that changed nothing | no commit (LayerFS makes none for an unchanged tree) | runs the command again | |

Write and edit are each one `fs.apply`, which is a single atomic commit with the message `pi-task:<taskId>\n<what>`. They need only three steps: memoize the base, look for the commit, and discard leftovers before writing.

**Fork** (`demo1/fork.ts`, scenario D). The new branch starts from the files as they were at the fork point. That is the commit of the newest tool result at or before it. If no call has committed yet, it is the branch head when the first call began (its memoized base), or else the branch's own fork base. It is named `c<conversation>-at-<entry>`, and a name that already exists counts as success. The fork's init writes its Branch doc. In D, forking at the result of the first write gives branch `c1-at-14`. It shares that write's commit with the original branch, runs bash again on its own branch, and then takes a different third step.

**Land**: merge first, then publish. main changes only by publish, and publishing a branch that was forked before main last moved would drop everything main gained since.

## Outputs

Recorded on 2026-11-19 with the pinned submodules. All 14 runs pass, and each takes about 7 to 15 s.

| | Run | What happened |
|---|---|---|
| A | Control: Pi's own `CodingTools` in a plain directory. SIGKILL 2 s into bash, restart. | The model is told "interrupted" and runs bash again. The orphaned shell kept writing: 5 lines at the kill, 7 a second later. b.txt ends with 20 lines instead of 10; tree `1eed7010`, clean run `3bc38745`. |
| B | The same kill, on the LayerFS tools. | The leftover Workspace (5 → 7 lines; 0 on the branch) is discarded and its orphan killed. bash reruns by itself and the model is never told. Tree = clean run, `3bc38745`; one commit per call. |
| C | Crash right after bash's commit (`CRASH_AT=after-commit`). | bash does not run again; its result comes from the commit. Tree = clean run. |
| D | Fork the finished run at its first tool result and send "[alt]". | The fork runs on branch `c1-at-14`: a.txt is "version 2 (alt)", and b.txt is rebuilt to 10 lines. The original branch is unchanged. |
| E | Event 42 delivered three times; events 43 and 44 fail admission. | One submission (id 8), one router input, one dispatch per worker. Events 43 and 44 are rejected before anything is submitted. |
| F | Crash right after the second `spawn_worker` (`CRASH_AT=after-spawn-b`). | Still two workers, each given its task once. Worker a's write, cut off by the crash, runs again by itself. The router goes on to wait and land. |
| G | SIGKILL while land waits for approval; the next run crashes right after the approval signal. | After the restart, land is still waiting. The repeated signal answers `duplicate`, and land runs once. |
| H | A full run. | Worker a's tests pass and worker b's fail. main gets a's fix.py and slugs.txt; tree `0230a138`. |
| I | SIGKILL 2 s into worker a's bash. | Worker a's leftover Workspace (3 → 5 lines) is discarded and its orphan killed; bash reruns and land runs once. main = the run without crashes, `0230a138`. |
| I-dir | The same kill, with workers in plain directories. | Worker a is told "interrupted" and reruns. The orphan and the rerun both write slugs.txt, which ends with 13 lines for 10 titles. Tests still pass and the router lands it: main is `dfa43d2d`. |

E-dir through H-dir are E–H with workers in plain directories, and they pass the same checks. In F-dir the crash cut off worker a's bash, which is not replay-safe there, so the model was told and ran it again.

The checks and notes of each run, as the driver printed them:

<details><summary><b>A</b> · control group: kill bash 2 s in, restart · PASS · 14.0 s</summary>

```text
· clean tree 3bc38745e34fc845: b.txt has 10 lines
✓ run 1 killed mid-command  (SIGKILL)
· b.txt when the process died: 5 of 10 lines
· b.txt 1 s later: 7 lines (the killed host's shell is an orphan and keeps writing)
✓ the model is told the command was interrupted
· final tree 1eed7010f8356aed: b.txt has 20 lines, the clean run 10
✓ the files do not match the clean run  (1eed7010f8356aed vs clean 3bc38745e34fc845)
```

</details>
<details><summary><b>B</b> · LayerFS: kill bash 2 s in, restart · PASS · 15.3 s</summary>

```text
· clean tree 3bc38745e34fc845: b.txt has 10 lines
✓ run 1 killed mid-command  (SIGKILL)
✓ a Workspace is left mounted on the branch  (1:/workspaces/2, Idle)
· b.txt in that Workspace: 5 lines when the process died, 7 a second later (the command is an orphan in the Sandbox and keeps writing, into the Workspace only)
· b.txt on the branch: 0 lines; nothing was committed
✓ run 2 finishes  (exit 0)
· the rerun of bash discarded 1:/workspaces/2 (killed: 36 bash -c for i in $(seq 1 10); do echo "line $i" >> b.txt; sleep 0.5; done ; 73 sleep 0.5 )
✓ the rerun discarded the leftover Workspace and killed its orphan
✓ bash ran again by itself; the model was never told it was interrupted
· final tree 3bc38745e34fc845: b.txt has 10 lines, the clean run 10
✓ one commit per tool call that changed files (write, bash, edit)  (["pi-task:13 · write /a.txt","pi-task:17 · exit:0","pi-task:21 · edit /a.txt"])
✓ the files match the clean run  (3bc38745e34fc845 vs clean 3bc38745e34fc845)
✓ no Workspace left mounted  ([])
```

</details>
<details><summary><b>C</b> · LayerFS: crash right after the bash commit · PASS · 13.5 s</summary>

```text
· clean tree 3bc38745e34fc845: b.txt has 10 lines
✓ run 1 dies right after committing bash's Workspace  (exit 137)
· on the branch: "pi-task:13 · write /a.txt", "pi-task:17 · exit:0"; the tool result never reached the Pi store
✓ bash's commit is on the branch, its Workspace still mounted (and clean)
✓ run 2 finishes  (exit 0)
✓ bash was not run again: its result came from the commit
· final tree 3bc38745e34fc845: b.txt has 10 lines, the clean run 10
✓ one commit per tool call that changed files (write, bash, edit)  (["pi-task:13 · write /a.txt","pi-task:17 · exit:0","pi-task:21 · edit /a.txt"])
✓ the files match the clean run  (3bc38745e34fc845 vs clean 3bc38745e34fc845)
✓ no Workspace left mounted  ([])
```

</details>
<details><summary><b>D</b> · fork the finished run at its first tool result · PASS · 12.0 s</summary>

```text
✓ run 1 finishes  (exit 0)
· fork the conversation at entry 14 (the result of write a.txt) and send it "[alt]"
✓ the fork finishes  (exit 0)
· the fork is conversation 25, on branch c1-at-14
✓ the fork's a.txt is the other version  (version 2 (alt)\n)
✓ the fork's b.txt was built again on its branch, 10 lines  (10 lines)
✓ the original branch is unchanged  (version 2\n)
```

</details>
<details><summary><b>E</b> · the same event delivered twice · PASS · 7.2 s</summary>

```text
✓ 3 deliveries of event 42, one submission id  ([8,8,8])
✓ the router got the event once  (1 input(s))
✓ one dispatch per worker
✓ the redelivery ran nothing
✓ events 43 and 44 rejected before any submission  (["43: missing the agent label","44: author mallory is not allowed"])
✓ policy rule 2 gates git push and rm -rf, not ls  ([true,true,false])
```

</details>
<details><summary><b>F</b> · crash right after the second spawn_worker · PASS · 7.1 s</summary>

```text
✓ run 1 dies at the crash point  (exit 137)
✓ run 2 finishes  (exit 0)
✓ 2 worker conversations in the store, no duplicates  (3 conversations incl. the router)
✓ worker a was given its task once  (1 input(s))
✓ worker b was given its task once  (1 input(s))
✓ spawn_worker b ran again and reused its worker
✓ the router went on to wait_workers and land
· worker tool calls cut off by the crash ran again by themselves (replay-safe)
✓ main has worker a's fix.py and slugs.txt
✓ worker b's branch is kept, not merged
✓ main's test_fix.py is unchanged
✓ tests pass on main
```

</details>
<details><summary><b>G</b> · crash while land waits for approval · PASS · 8.4 s</summary>

```text
✓ run 1 killed while land waits for approval  (SIGKILL)
· pending: 67.e84b99644b06a428
· restart; this time the host also crashes right after delivering the approval signal
✓ after the restart land still waits for approval  (["67.e84b99644b06a428"])
✓ run 2 dies right after the signal  (exit 137)
· restart: the answer file was not moved to done/, so it is signalled again
✓ run 3 finishes  (exit 0)
✓ the repeated signal answers duplicate; the first value stands  (["delivered","duplicate"])
✓ land ran exactly once  (["worker a -> main (fix.py, slugs.txt)"])
✓ no approval left pending
✓ main has worker a's fix.py and slugs.txt
✓ worker b's branch is kept, not merged
✓ main's test_fix.py is unchanged
✓ tests pass on main
```

</details>
<details><summary><b>H</b> · a full run · PASS · 7.0 s</summary>

```text
✓ the run finishes  (exit 0)
✓ 2 worker conversations in the store, no duplicates  (3 conversations incl. the router)
✓ worker a was given its task once  (1 input(s))
✓ worker b was given its task once  (1 input(s))
✓ wait_workers reports a passing, b failing  (a: done, tests exit 0\nb: done, tests exit 1)
✓ the router landed a
✓ main has worker a's fix.py and slugs.txt
✓ worker b's branch is kept, not merged
✓ main's test_fix.py is unchanged
✓ tests pass on main
· main 0230a138fab83357, a clean run 0230a138fab83357: slugs.txt has 10 lines (10 titles)
✓ main matches a run without crashes  (0230a138fab83357 vs 0230a138fab83357)
```

</details>
<details><summary><b>I</b> · kill the host while worker a's bash runs · PASS · 10.2 s</summary>

```text
✓ run 1 killed 2 s into worker a's bash  (SIGKILL)
✓ worker a's Workspace is left mounted, its command still writing  (3 → 5 lines)
· slugs.txt in worker a's leftover Workspace: 3 lines when the host died, 5 a second later; on its branch nothing yet
✓ run 2 finishes  (exit 0)
✓ 2 worker conversations in the store, no duplicates  (3 conversations incl. the router)
✓ worker a was given its task once  (1 input(s))
✓ worker b was given its task once  (1 input(s))
· worker a's bash ran again by itself and first discarded 1:/workspaces/2 (killed: 24 bash -c export PYTHONDONTWRITEBYTECODE=1; python3 gen_slugs.py && python3 -m pytest -q -p no:cacheprovider ; 30 python3 gen_slugs.py )
✓ the rerun discarded worker a's leftover Workspace and killed its orphan
✓ no worker was told a call was interrupted
✓ land ran exactly once
✓ main has worker a's fix.py and slugs.txt
✓ worker b's branch is kept, not merged
✓ main's test_fix.py is unchanged
✓ tests pass on main
· main 0230a138fab83357, a clean run 0230a138fab83357: slugs.txt has 10 lines (10 titles)
✓ main matches a run without crashes  (0230a138fab83357 vs 0230a138fab83357)
```

</details>
<details><summary><b>I-dir</b> · kill the host while worker a's bash runs · PASS · 10.4 s</summary>

```text
✓ run 1 killed 2 s into worker a's bash  (SIGKILL)
· slugs.txt in worker a's directory: 5 lines when the host died, 7 a second later (its command is an orphan and keeps writing)
✓ run 2 finishes  (exit 0)
✓ 2 worker conversations in the store, no duplicates  (3 conversations incl. the router)
✓ worker a was given its task once  (1 input(s))
✓ worker b was given its task once  (1 input(s))
✓ worker a was told its bash was interrupted, and ran it again
✓ land ran exactly once
✓ main has worker a's fix.py and slugs.txt
✓ worker b's directory is kept, not merged
✓ main's test_fix.py is unchanged
✓ tests pass on main
· main dfa43d2ddc902a10, a clean run 0230a138fab83357: slugs.txt has 13 lines (10 titles)
✓ main does not match a run without crashes  (dfa43d2ddc902a10 vs 0230a138fab83357)
```

</details>

## Guarantees and limits

What the scenarios show:

- If the host process dies at any point (SIGKILL, a crash, an exit), restarting it on the same store finishes the work. The files end as they would after one run without the crash: B, C and I compare tree hashes against such a run.
- Each tool call that changes files makes exactly one commit, tagged with its task ID.
- An event delivered more than once starts one run. Each worker is dispatched once, land runs once, and a pending approval survives restarts.
- A forked conversation gets its own branch, which starts at the commit that matches the fork point.

What is not covered:

- **Only file side effects inside the Sandbox.** Network calls, `git push`, external APIs, and anything else outside the Workspace are not protected. A tool with such effects needs its own idempotency key; `api.taskId` is stable across reruns and can serve as one.
- **Process crashes, not machine crashes.** LayerFS's Store runs only in its Disposable profile, which LayerFS's README describes as having "no crash or power-loss durability". The scenarios kill a process, and the OS keeps what that process had written. After a kernel crash or a power cut, LayerFS can lose commits that Pi's store already counts on.
- **A command that changes nothing may run twice.** It makes no commit, so a crash after it, before its result is stored, runs it again. That is harmless for read-only commands such as tests, but not for commands with effects outside the Workspace.
- **Conflicts are per file.** Two workers that change the same file conflict at merge. Here only one worker lands and the others are kept unmerged; line-level merging would be a next step.
- **The two stores are never updated atomically.** Correctness rests on reruns being idempotent, keyed by the task ID in the commit message.
- **The model is scripted.** No run has used a real model yet.

## Running it

```sh
git clone --recurse-submodules git@github.com:fishmingyu/lockstep.git && cd lockstep
npm run setup        # build Pi and LayerFS from the submodules, and the Sandbox image (about 2 min)
npm run demo1        # A–D (npm run demo1 -- B for one)
npm run demo2        # E–I, workers on LayerFS branches
npm run demo2:dir    # E-dir … I-dir, workers in plain directories (needs python3 with pytest, and rsync)
npm run site         # the recorded runs, at http://localhost:5173
```

You need Linux x86_64 with Docker and `/dev/fuse`, and Node ≥ 22.19. Pi Durable (`vendor/pi`, 1f6f319) and LayerFS (`vendor/layerfs`, 7d42d0b) are submodules pinned at the commits the runs were recorded with. `scripts/setup.sh` says what it builds and why. Even as a shallow clone, the LayerFS submodule is about 800 MB.

LayerFS's Store lives in a Docker volume that only root can reach. So each LayerFS scenario runs its driver and hosts as root in a client container (`shared/container.ts`), with a fresh project and volume. Traces go to `runs/traces/`, and `npm run site:bake` copies them into the site.
