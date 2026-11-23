#!/usr/bin/env bash
# Pi Durable is used from source at a pinned commit: the npm release of pi-durable 1.5.2 predates this commit and
# lacks APIs the demos use (defineSignal, among others). This clones pi into vendor/pi, builds it, and installs.
set -euo pipefail
cd "$(dirname "$0")/.."
PI_COMMIT=1f6f319bb28992a40b99c147fffb23b65a23129d
if [ ! -d vendor/pi/.git ]; then
	git clone https://github.com/earendil-works/pi.git vendor/pi
fi
git -C vendor/pi fetch --quiet origin "$PI_COMMIT" 2>/dev/null || true
git -C vendor/pi checkout --quiet "$PI_COMMIT"
(cd vendor/pi && npm install && npm run build)
# --legacy-peer-deps: npm's arborist crashes resolving the peer sets of file: links into the pi workspace.
npm install --legacy-peer-deps
echo "ok: pi $(git -C vendor/pi rev-parse --short HEAD)"
