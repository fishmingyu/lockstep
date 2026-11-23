#!/usr/bin/env bash
# S0 driver: steps 2-4 end to end, re-runnable.
#   bash s0/probe.sh            # fresh project Store volume each run, removed at the end
#   S0_KEEP=1 bash s0/probe.sh  # keep the volume/project for inspection
#
# 1. setup   (process A): init/open project, fork "probe", sandbox.create, wait 1.5 s
# 2. run     (process B): mount, exec a 30 x 0.5 s loop that appends to progress.txt
# 3. SIGKILL process B ~3 s into the exec (docker kill -s KILL its client container)
# 4. recover (process C): look for pi-task:<id> commit (none), list leftovers, discard
#    (Busy while the orphaned command still runs -> force), verify branch unchanged
# 5. rerun   (process D): same task to completion -> commit pi-task:<id>
# 6. recover (process E): now finds the commit, nothing to discard
# 7. cleanup (process F): close the Sandbox; remove the volume unless S0_KEEP
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
run_id=$(date +%s)
export S0_VOLUME=${S0_VOLUME:-s0-probe-$run_id}
export LAYERFS_PROJECT=${LAYERFS_PROJECT:-s0probe$run_id}
task=t$run_id
out=$(mktemp -d)
lfs() { "$here/lfs.sh" "$@"; }

docker volume inspect "$S0_VOLUME" >/dev/null 2>&1 || docker volume create "$S0_VOLUME" >/dev/null
echo "== volume $S0_VOLUME project $LAYERFS_PROJECT task $task"

echo "== [A] setup"
lfs node probe.mjs setup | tee "$out/setup"
sandbox=$(sed -n 's/^SANDBOX=//p' "$out/setup")

echo "== [B] run (will be SIGKILLed)"
S0_NAME=s0-client-$run_id lfs node probe.mjs run "$sandbox" "$task" 30 >"$out/run" 2>&1 &
bg=$!
until grep -q '^WS=' "$out/run" 2>/dev/null; do sleep 0.2; done
sleep 3
docker kill --signal=KILL "s0-client-$run_id" >/dev/null
wait "$bg" && rc=0 || rc=$?
cat "$out/run"; echo "   client exit status $rc (137 = SIGKILL)"

echo "== [C] recover from a new process (orphaned command still running)"
lfs node probe.mjs recover "$sandbox" "$task" | tee "$out/recover1"

echo "== [D] rerun the task to completion"
lfs node probe.mjs run "$sandbox" "$task" 4 | tee "$out/run2"

echo "== [E] recover again: the task commit is found"
lfs node probe.mjs recover "$sandbox" "$task" | tee "$out/recover2"

echo "== [F] cleanup"
lfs node probe.mjs cleanup
if [[ -z ${S0_KEEP:-} ]]; then
  docker volume rm "$S0_VOLUME" >/dev/null && echo "removed volume $S0_VOLUME"
  # The project's discovery record in the shared home volume points at the removed volume.
  docker run --rm -v s0-layerfs-home:/h node:22-slim rm -rf "/h/home/$LAYERFS_PROJECT"
fi
grep -q 'RECOVERED=discarded-rerun-needed' "$out/recover1" && grep -q 'RECOVERED=found-commit' "$out/recover2" \
  && echo "S0 PASS" || { echo "S0 FAIL"; exit 1; }
rm -rf "$out"
