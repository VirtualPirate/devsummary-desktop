#!/usr/bin/env bash
# §2 "Launch on Linux (AppImage)" — run the AppImage in the container built by
# Dockerfile.linux and leave the app's userData on the host, where
# check-linux.mjs asserts against it.
#
#   apps/desktop/test/platform/run-appimage.sh <AppImage> <host-userData-dir> [platform]
#
# `platform` is a docker --platform value. The shipped target is x64, so
# linux/amd64 is the default and on Apple silicon it runs emulated; linux/arm64
# runs natively and is the faster sanity check of the same code.
set -euo pipefail
appimage=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
userdata=$2
platform=${3:-linux/amd64}
tag="devsummary-linux-test-${platform##*/}"
mkdir -p "$userdata"
docker build -q --platform "$platform" -t "$tag" -f "$(dirname "$0")/Dockerfile.linux" "$(dirname "$0")" >/dev/null
# --shm-size: Chromium's default 64 MB of /dev/shm in a container is not enough
# for its GPU process, and it takes the whole app down when that process dies.
docker run --rm --platform "$platform" --shm-size=1g \
  -v "$appimage:/opt/DevSummary.AppImage:ro" \
  -v "$userdata:/home/app/data" \
  "$tag" \
  bash -c '
    set -e
    cp /opt/DevSummary.AppImage /tmp/app.AppImage && chmod +x /tmp/app.AppImage
    cd /tmp && ./app.AppImage --appimage-extract >/dev/null
    # The extraction runs as root and keeps squashfs modes; the app user has to
    # be able to walk and execute what came out of it.
    chmod -R a+rX /tmp/squashfs-root
    chown -R app:app /home/app/data
    # --no-sandbox is what the shipped launcher uses: electron-builder writes
    # `Exec=AppRun --no-sandbox %U` into desktop.desktop itself. The GPU flags are
    # this container, not the product — there is no GPU behind Xvfb.
    su app -c "cd /tmp && timeout 600 xvfb-run -a ./squashfs-root/AppRun \
        --no-sandbox --disable-gpu --disable-gpu-sandbox --disable-dev-shm-usage \
        --user-data-dir=/home/app/data" > /tmp/app-stderr.log 2>&1 &
    for i in $(seq 1 300); do
      sleep 2
      if grep -qs "statusCode" /home/app/data/logs/app.log* ; then
        echo "renderer reached the API at $((i * 2))s"; sleep 10; break
      fi
      if grep -qs "Nest application successfully started" /home/app/data/logs/app.log* && [ $i -gt 60 ]; then
        echo "backend up, renderer never called"; break
      fi
    done
    pkill -f squashfs-root/desktop || true
    sleep 3
    chown -R 1000:1000 /home/app/data
    echo "---- app stderr ----"; tail -6 /tmp/app-stderr.log
  '
