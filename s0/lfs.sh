#!/usr/bin/env bash
# Run one command in a LayerFS *client* container.
#
# Why a container: on Linux the SDK opens the Store file in-process, and the
# Store must live in a plain local Docker volume (no driver options; the
# daemon checks). That volume's directory (/mnt/data/docker/volumes/...) is
# root-only on this host, so the SDK process runs as root in a container
# that mounts the volume at /layerfs-store, the Docker socket, and the repo
# at the same path. --network host because each Sandbox daemon publishes its
# control port on the Docker host's 127.0.0.1 only.
#
# Usage:  s0/lfs.sh node probe.mjs <step>          (cwd in the container is s0/)
#         s0/lfs.sh layerfs <family> <call> ...     (the layerfs CLI)
#         S0_NAME=foo s0/lfs.sh ...                 (name the client container)
#         S0_VOLUME=vol LAYERFS_PROJECT=p s0/lfs.sh ...   (another project/Store volume)
set -euo pipefail
REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
CLIENT_IMAGE=${S0_CLIENT_IMAGE:-node:22-slim}           # Debian 12, Node 22.23, glibc 2.36
VOLUME=${S0_VOLUME:-s0-layerfs-store}                    # one plain local volume per project Store
SANDBOX_IMAGE=${S0_SANDBOX_IMAGE:-$(docker image inspect --format '{{.Id}}' node:22-slim)}
cmd=("$@")
if [[ ${cmd[0]:-} == layerfs ]]; then
  cmd=(node "$REPO/vendor/layerfs/api/cli/src/layerfs.js" "${cmd[@]:1}")
fi
exec docker run --rm -i ${S0_NAME:+--name "$S0_NAME"} --network host \
  --label s0.lockstep=client \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$VOLUME:/layerfs-store" \
  -v s0-layerfs-home:/layerfs-home \
  -v "$REPO:$REPO" -w "$REPO/s0" \
  -e LAYERFS_HOME=/layerfs-home/home \
  -e LAYERFS_STORE_PATH=/layerfs-store/global/store.sqlite \
  -e LAYERFS_VOLUME="$VOLUME" \
  -e LAYERFS_IMAGE="$SANDBOX_IMAGE" \
  -e LAYERFS_DAEMON="$REPO/vendor/layerfs/target/s0/layerfs-daemon" \
  -e LAYERFS_DOCKER=/var/run/docker.sock \
  -e LAYERFS_CONTAINER_PREFIX=s0-layerfs- \
  -e LAYERFS_PROJECT="${LAYERFS_PROJECT:-s0probe}" \
  ${S0_ENV:+-e "$S0_ENV"} \
  "$CLIENT_IMAGE" "${cmd[@]}"
