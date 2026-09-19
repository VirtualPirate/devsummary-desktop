# Installing from apt (Debian, Ubuntu)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://virtualpirate.github.io/devsummary-desktop/devsummary.asc \
  | sudo tee /etc/apt/keyrings/devsummary.asc >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/devsummary.asc] https://virtualpirate.github.io/devsummary-desktop ./" \
  | sudo tee /etc/apt/sources.list.d/devsummary.list
sudo apt update && sudo apt install devsummary
```

Then `devsummary`, or the launcher entry. Upgrades come from `apt upgrade` like any other package —
the in-app updater deliberately stands down on a deb build (`canInstallInPlace` in
`apps/desktop/src/updater.ts`), so the two never race to install over each other. Removal is
`sudo apt remove devsummary`; that leaves `~/.config/DevSummary` alone, which is where your database
lives — see the README's uninstall section.

`signed-by` pins this repository to one key. Dropping it, or reaching for `[trusted=yes]`, tells apt
to run whatever that URL hands back as root, which is the one shortcut not worth taking here. The
key you just fetched should be this one, and checking that costs a command:

```
$ gpg --show-keys /etc/apt/keyrings/devsummary.asc
pub   rsa4096 2026-09-19 [SC]
      11AE D603 5963 3EF2 1BE7  6AB2 6179 05AA 05B3 D070
uid                      DevSummary APT Repository <artaza.developer@gmail.com>
```

A fingerprint read off the same web server that served the key proves nothing on its own — it is
worth the most when you compare it against a copy from somewhere else (the git history of this
file, a release announcement).

Not on Debian or Ubuntu? The [releases page](https://github.com/VirtualPirate/devsummary-desktop/releases)
has an AppImage, which self-updates, plus the mac and Windows builds.

## What the repository is

A flat, GPG-signed apt repository on GitHub Pages: the `.deb`, a `Packages` index, a `Release` file
and its signature in one directory, no `dists/` tree. `scripts/apt-repo.sh` builds it and
`.github/workflows/apt.yml` publishes it when a GitHub release is **published** — never on the tag
push, because that release is a draft until a human says otherwise, and an apt repo is not the place
to find out a release was not meant to ship yet.

It serves **one version at a time**: the Pages deployment replaces the whole site, so the current
release is what is installable. That is enough to install and upgrade, and not enough to pin or roll
back to an older version — for that, download the deb from the releases page directly. Holding
history means downloading the last N releases' debs in that workflow and living with a 1 GB Pages
site limit against roughly 115 MB per deb.

## Running it yourself

The script takes a directory of debs and a signing key, and refuses to finish until a container's
apt has verified the signature and resolved the package out of the index it just built:

```bash
pnpm build && pnpm --filter desktop exec electron-builder --linux deb --x64
KEYID=<your key> scripts/apt-repo.sh          # Docker on macOS, native on Debian/Ubuntu
```

The private key signs the index, and that signature is the only thing standing between a user's
`apt install` and whatever a hostile network returns. Keep it offline or in the CI secret store; the
CI key is passphrase-less by necessity (unattended signing), which is another reason it should sign
nothing else.

The key in use, `11AED60359633EF21BE76AB2617905AA05B3D070`, is a dedicated rsa4096 signing key with
no expiry — an expired repository key locks out every user who already has the old copy on disk,
which is a worse failure than the one expiry protects against. What replaces expiry is the
revocation certificate gpg wrote at creation time, in `~/.gnupg/openpgp-revocs.d/` on the machine
that made it. That certificate and a backup of the private key belong somewhere that is not that
one machine:

```bash
gpg --armor --export-secret-keys 11AED60359633EF21BE76AB2617905AA05B3D070   # to a password manager
```

Lose the private key with no backup and the repository cannot be updated again — a new key means
every existing user has to install the new one by hand before `apt update` works.
