#!/usr/bin/env bash
# The deb the apt repo serves, installed with apt and launched — the AppImage's
# sibling. Same container, same evidence, same host-side assertions:
#
#   apps/desktop/test/platform/run-deb.sh <deb> <host-userData-dir> [platform]
#   node apps/desktop/test/platform/check-linux.mjs <host-userData-dir> deb
#
# Different from run-appimage.sh in the two ways that matter for this target:
# the package goes in through `apt-get install`, so postinst runs (the
# /usr/bin symlink, chrome-sandbox's mode, the AppArmor profile) and the
# dependency list in the control file is actually resolved; and the launcher is
# the one the .desktop entry names, with no --no-sandbox, because
# electron-builder does not put that flag in a deb's Exec line the way it does
# in an AppImage's.
set -euo pipefail
deb=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
userdata=$2
platform=${3:-linux/amd64}
tag="devsummary-linux-test-${platform##*/}"
mkdir -p "$userdata"
docker build -q --platform "$platform" -t "$tag" -f "$(dirname "$0")/Dockerfile.linux" "$(dirname "$0")" >/dev/null
# --shm-size: Chromium's default 64 MB of /dev/shm in a container is not enough
# for its GPU process, and it takes the whole app down when that process dies.
# --security-opt seccomp=unconfined: the deb keeps Chromium's SUID sandbox, and
# docker's default seccomp profile denies the namespace syscalls it clones with
# ("Failed to move to new namespace ... Operation not permitted", then a FATAL in
# zygote_host_impl_linux.cc). A real desktop permits them; the container is the
# artificial constraint, and turning the sandbox off instead would skip the one
# thing this target does differently from the AppImage.
docker run --rm --platform "$platform" --shm-size=1g --security-opt seccomp=unconfined \
  -v "$deb:/tmp/devsummary.deb:ro" \
  -v "$userdata:/home/app/data" \
  "$tag" \
  bash -c '
    set -e
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/devsummary.deb >/dev/null
    chown -R app:app /home/app/data
    # /usr/bin/devsummary — the symlink postinst made, not a path into /opt, so
    # a broken alternatives entry fails here rather than in a user report. No
    # --no-sandbox: the deb keeps the SUID chrome-sandbox postinst set up, which
    # is the whole difference from the AppImage. The GPU flags are this
    # container, not the product — there is no GPU behind Xvfb.
    su app -c "cd /tmp && timeout 600 xvfb-run -a /usr/bin/devsummary \
        --disable-gpu --disable-gpu-sandbox --disable-dev-shm-usage \
        --user-data-dir=/home/app/data" > /tmp/app-stderr.log 2>&1 &
    app_pid=$!
    for i in $(seq 1 300); do
      sleep 2
      if grep -qs "statusCode" /home/app/data/logs/app.log* ; then
        echo "renderer reached the API at $((i * 2))s"; sleep 10; break
      fi
      if grep -qs "Nest application successfully started" /home/app/data/logs/app.log* && [ $i -gt 60 ]; then
        echo "backend up, renderer never called"; break
      fi
      # An app that died is not an app that is slow. Without this the loop waits
      # out the full 600 s after a crash in the first two seconds, and the stderr
      # explaining why scrolls past ten minutes late.
      if ! kill -0 $app_pid 2>/dev/null; then
        echo "the app exited after $((i * 2))s — see stderr below"; break
      fi
    done
    pkill -f /opt/DevSummary/devsummary || true
    sleep 3
    chown -R 1000:1000 /home/app/data
    echo "---- app stderr ----"; tail -6 /tmp/app-stderr.log
  '
