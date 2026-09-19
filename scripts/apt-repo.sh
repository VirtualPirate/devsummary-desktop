#!/usr/bin/env bash
#
# Build a flat, GPG-signed apt repository out of a directory of .deb files, then
# prove apt accepts it before it is published.
#
#   KEYID=<signing key> scripts/apt-repo.sh [--debs DIR] [--no-verify] [OUTDIR]
#
# Defaults: --debs apps/desktop/release, OUTDIR aptrepo. Copy OUTDIR to any
# static HTTPS host; .github/workflows/apt.yml does it to GitHub Pages when a
# release is published. Users then:
#
#   sudo install -m 0755 -d /etc/apt/keyrings
#   curl -fsSL https://<host>/devsummary.asc | sudo tee /etc/apt/keyrings/devsummary.asc >/dev/null
#   echo "deb [signed-by=/etc/apt/keyrings/devsummary.asc] https://<host> ./" \
#     | sudo tee /etc/apt/sources.list.d/devsummary.list
#   sudo apt update && sudo apt install devsummary
#
# "Flat" means no dists/ tree: the debs, one Packages index and one Release sit
# in a single directory. It is the smallest layout apt accepts and the only one
# worth hand-rolling — reach for aptly or reprepro when suites, components or
# pooled storage start to matter, not before.
#
# The signature on the index is the entire trust boundary. Without it every user
# has to pass [trusted=yes] and accept whatever answers the URL, so KEYID is
# required rather than optional. Keep the private half offline or in CI secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="aptrepo"
DEBS_DIR="$ROOT/apps/desktop/release"
VERIFY=1

while (( $# )); do
  case "$1" in
    --debs) DEBS_DIR="$2"; shift 2 ;;
    --no-verify) VERIFY=0; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) OUT="$1"; shift ;;
  esac
done

: "${KEYID:?set KEYID to the gpg key that signs this repo}"
command -v gpg >/dev/null || { echo "gpg is required" >&2; exit 1; }

mkdir -p "$OUT"
OUT_DIR="$(cd "$OUT" && pwd)"

shopt -s nullglob
debs=("$DEBS_DIR"/*.deb)
shopt -u nullglob
(( ${#debs[@]} )) || {
  echo "no .deb in $DEBS_DIR — build one with:" >&2
  echo "  pnpm build && pnpm --filter desktop exec electron-builder --linux deb --x64" >&2
  exit 1
}

cp "${debs[@]}" "$OUT_DIR"/

# Stale signatures go before the Release they signed is regenerated. A run that
# dies in the middle must not leave an InRelease behind that still verifies and
# still describes the previous index.
rm -f "$OUT_DIR/Release" "$OUT_DIR/Release.gpg" "$OUT_DIR/InRelease"

# dpkg-scanpackages (dpkg-dev) and apt-ftparchive (apt-utils) are Debian tools.
# Native on a CI runner, containerised on the Mac this project is developed on.
index() {
  # gzip before apt-ftparchive: it checksums the index files it finds on disk.
  # Its own output goes via a temp file outside that directory — `> Release`
  # would create the file before apt-ftparchive starts, leaving Release
  # checksumming its own half-written self. apt ignores the entry, but it is a
  # confusing line to leave inside the file the signature covers.
  dpkg-scanpackages --multiversion . > Packages
  gzip -9fk Packages
  apt-ftparchive -o APT::FTPArchive::Release::Origin=DevSummary \
                 -o APT::FTPArchive::Release::Label=DevSummary \
                 release . > /tmp/Release.$$ && mv /tmp/Release.$$ Release
}

if command -v dpkg-scanpackages >/dev/null && command -v apt-ftparchive >/dev/null; then
  ( cd "$OUT_DIR" && index )
else
  command -v docker >/dev/null || {
    echo "need dpkg-dev + apt-utils, or docker to borrow them from a Debian image" >&2
    exit 1
  }
  docker run --rm -v "$OUT_DIR:/repo" -w /repo debian:bookworm-slim bash -euc '
    apt-get update -qq
    apt-get install -yqq --no-install-recommends dpkg-dev apt-utils >/dev/null
    dpkg-scanpackages --multiversion . > Packages
    gzip -9fk Packages
    apt-ftparchive -o APT::FTPArchive::Release::Origin=DevSummary \
                   -o APT::FTPArchive::Release::Label=DevSummary \
                   release . > /tmp/Release.$$ && mv /tmp/Release.$$ Release
  '
fi

# Both signatures: InRelease for apt >= 1.1, Release.gpg for anything older
# still pointed at this URL.
gpg --batch --yes --local-user "$KEYID" --clearsign -o "$OUT_DIR/InRelease" "$OUT_DIR/Release"
gpg --batch --yes --local-user "$KEYID" --detach-sign --armor -o "$OUT_DIR/Release.gpg" "$OUT_DIR/Release"
gpg --export --armor "$KEYID" > "$OUT_DIR/devsummary.asc"

if (( VERIFY )); then
  command -v docker >/dev/null || { echo "docker is required to verify; pass --no-verify to skip" >&2; exit 1; }

  # apt only sees packages built for the architecture it runs as, so the
  # container's platform has to match a deb in the repo — otherwise the solve
  # fails with "Unable to locate package" while the index is perfectly fine.
  # One arch is enough: the signature and the index are arch-independent.
  if compgen -G "$OUT_DIR/*_amd64.deb" >/dev/null; then platform=linux/amd64; else platform=linux/arm64; fi

  # The check. A real apt, verifying a real signature against the exported
  # public key, then solving the real index. Fails on an unsigned or tampered
  # index, a key that does not match, a malformed Release, or a package whose
  # dependencies are unsatisfiable on a clean Debian. --print-uris keeps it
  # cheap: the 100 MB payload is never downloaded.
  docker run --rm --platform "$platform" -v "$OUT_DIR:/repo:ro" debian:bookworm-slim bash -euc '
    apt-get update -qq
    install -m 0755 -d /etc/apt/keyrings
    cp /repo/devsummary.asc /etc/apt/keyrings/devsummary.asc
    echo "deb [signed-by=/etc/apt/keyrings/devsummary.asc] file:///repo ./" \
      > /etc/apt/sources.list.d/devsummary.list
    apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/devsummary.list \
                   -o Dir::Etc::sourceparts=/dev/null -o APT::Get::List-Cleanup=0
    apt-get install --print-uris -y devsummary >/dev/null
  '
  echo "verified: apt accepted the signed index and resolved devsummary"
fi

echo "repo ready: $OUT_DIR"
ls -1 "$OUT_DIR"
