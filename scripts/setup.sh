#!/usr/bin/env bash
# Everything the demos need, from a fresh clone (`git clone --recurse-submodules`, or plain `git clone`: the
# submodules are fetched here). Safe to run again; it rebuilds what changed. Needs git, Node >= 22.19, and Docker.
#
#   vendor/pi       Pi Durable, from source at the pinned commit: the npm release of pi-durable 1.5.2 predates it and
#                   lacks APIs the demos use (defineSignal, among others).
#   vendor/layerfs  LayerFS 1.1.0: its Node addon (loaded by the clients) and layerfs-daemon (run in each Sandbox).
#                   Both are built in rust:1.85.1-bookworm: LayerFS builds with Rust 1.85.1, and bookworm's glibc (2.36)
#                   is the one in node:22-slim, which is the client image and the Sandbox image's base.
#   lockstep-sandbox:1   the Sandbox image: node:22-slim with python3 and pytest, for Demo 2's tests.
#
# Build outputs stay out of git: the Cargo cache in .build/ (ignored here), the addon and the daemon inside
# vendor/layerfs (ignored by LayerFS), and npm's changes inside the submodules (`ignore = dirty` in .gitmodules).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
RUST_IMAGE=rust:1.85.1-bookworm
step() { printf '\n== %s\n' "$*"; }

step "submodules at their pinned commits"
git submodule update --init
git submodule status

step "Pi: install and build"
(cd vendor/pi && npm install --no-audit --no-fund && npm run build)

step "LayerFS: Node addon and daemon, in $RUST_IMAGE"
mkdir -p .build/cargo-home .build/layerfs-target
# As the invoking user, so the cache and the outputs are not root's. The Cargo home is outside the image's, so cargo
# is called by its full path.
docker run --rm --user "$(id -u):$(id -g)" \
	-v "$ROOT/vendor/layerfs:/work" -v "$ROOT/.build/cargo-home:/cargo" -v "$ROOT/.build/layerfs-target:/target" \
	-e CARGO_HOME=/cargo -e CARGO_TARGET_DIR=/target -w /work \
	"$RUST_IMAGE" bash -euo pipefail -c '
		cargo=/usr/local/cargo/bin/cargo
		$cargo fetch --manifest-path Cargo.toml --locked
		$cargo build --manifest-path Cargo.toml --offline --locked --release -p layerfs-node --lib -p layerfs-daemon --bins'
# Where shared/container.ts and the SDK look for them. Copied to a temporary name first, so a running process never
# sees half a file.
put() { cp "$1" "$2.new" && mv -f "$2.new" "$2"; }
mkdir -p vendor/layerfs/target/s0
put .build/layerfs-target/release/layerfs-daemon vendor/layerfs/target/s0/layerfs-daemon
put .build/layerfs-target/release/liblayerfs_node.so vendor/layerfs/engine/crates/layerfs-node/layerfs.node

step "LayerFS: link its JS packages (agent, backend, runtime) to each other"
(cd vendor/layerfs/api && npm install --no-package-lock --no-audit --no-fund)

step "the Sandbox image"
docker build -t lockstep-sandbox:1 -f docker/sandbox.Dockerfile docker

step "this package"
# --legacy-peer-deps: npm's arborist crashes resolving the peer sets of file: links into the pi workspace.
npm install --legacy-peer-deps --no-audit --no-fund

echo
echo "ok: pi $(git -C vendor/pi rev-parse --short HEAD), layerfs $(git -C vendor/layerfs rev-parse --short HEAD)"
