# Web deploy (SSR) — one tag, no manual upload

Building `dist/ssr` on your machine and copying it to the box is gone. The chain is:

```
git tag v1.4.9 && git push origin v1.4.9
        |
        v
GitHub Actions "MOURN Web (SSR) Build & Publish"        (ubuntu runner, ~4 min)
        |  bun install --frozen-lockfile
        |  quasar build -m ssr
        |  npm install --package-lock-only   <- pins the runtime tree (npm ci on the box)
        v
Release v1.4.9 gets two extra assets next to the desktop/mobile ones:
        mourn-web-ssr-1.4.9.tar.gz
        mourn-web-ssr-1.4.9.tar.gz.sha256
        |
        v
Windows box, pm2 process `mourn-web-updater` (polls every 60 s, no inbound port):
        mourn-web-deploy.mjs
           newest release tag != live tag?
           download -> verify SHA-256 -> unpack to releases\<tag>
           -> link the pinned node_modules -> repoint `current`
           -> pm2 restart <web process> -> HTTP health check
           -> on failure: repoint back to the previous release + restart
```

Nothing is required on the box but outbound HTTPS to `api.github.com` and the
release asset host. No SSH, no WinSCP, no RDP copy-paste.

The web workflow is a separate file (`web-release.yml`) on purpose: `release.yml`
is tag-critical for the signed desktop and Android artifacts and is untouched.

## One-time setup on the production box

Run this in the Windows account that owns the pm2 daemon (the one where
`pm2 list` shows `mourn-api`), not as another user or SYSTEM — pm2 keeps one
daemon per user.

1. Create a GitHub fine-grained PAT: Settings → Developer settings → Fine-grained
   tokens → Generate new token.
   - Repository access: only `crossx256/mourn`
   - Permissions: **Contents → Read-only** (nothing else)
   - Expiry: 1 year, then rotate

2. Put the deployer and the token on the box (this is the last manual copy):

```powershell
mkdir C:\mourn\mourn-web -Force
# copy deploy\mourn-web-deploy.mjs from the repo into C:\mourn\mourn-web\
Set-Content -Path C:\mourn\mourn-web\gh-token.txt -Value 'github_pat_xxx' -NoNewline -Encoding ascii
```

The token file is read by the deployer at startup, so it never appears in a pm2
command line or in `pm2 env`. Lock it down:

```powershell
icacls C:\mourn\mourn-web\gh-token.txt /inheritance:r /grant:r "$env:USERNAME:(R,W)"
```

3. Dry run — this is a single tick of what the updater will do:

```powershell
node C:\mourn\mourn-web\mourn-web-deploy.mjs --status
node C:\mourn\mourn-web\mourn-web-deploy.mjs          # deploy the newest release now
```

The first real run adopts your existing web process: if pm2 is currently running
the hand-uploaded folder, the deployer deletes that entry and starts
`C:\mourn\mourn-web\current\index.js` under the same name. The first run also
installs the runtime dependencies once (`npm ci`, ~280 MB unpacked) — after that
deploys that do not change `package.json` install nothing.

4. Start the poller under pm2 and persist it:

```powershell
pm2 start C:\mourn\mourn-web\mourn-web-deploy.mjs --name mourn-web-updater -- --watch --install-root C:\mourn\mourn-web --port 3001
pm2 save
```

Use `--port` if your SSR listens somewhere other than 3001 (the health check
probes `http://127.0.0.1:<port>/`). Note that the port is baked into the bundle by
Quasar's `prodPort` at build time, so a deployed bundle listens on 3001 whatever
`PORT` you set at runtime — `--port` is there for the day that changes.

Prefer Task Scheduler to a resident watcher? Same command, once a minute:

```powershell
schtasks /Create /TN "Mourn-Web-Deploy" /SC MINUTE /MO 1 /RL HIGHEST /F `
  /TR "node C:\mourn\mourn-web\mourn-web-deploy.mjs --install-root C:\mourn\mourn-web --port 3001"
```

## Every release after that

```powershell
git tag v1.4.9
git push origin v1.4.9
```

Nothing else. The web job publishes the bundle ~4 minutes after the tag, and the
box picks it up within a minute of that. `deploy.log` gets one line per deploy and
stays silent while there is nothing to do.

## Commands you will actually use

```powershell
# what is live: tag, commit, pm2 process, junction, port, releases on disk
# (local only - needs no token, contacts nothing)
node C:\mourn\mourn-web\mourn-web-deploy.mjs --status

# deploy the newest release even though it already looks live (also repairs a dead app)
node C:\mourn\mourn-web\mourn-web-deploy.mjs --force

# roll back to a previous release (any tag whose release still carries the assets)
node C:\mourn\mourn-web\mourn-web-deploy.mjs --tag v1.4.7 --force

# re-publish the web bundle for an existing tag without cutting a new version
gh workflow run web-release.yml -f tag=v1.4.9

# updater health
pm2 list
pm2 logs mourn-web-updater --lines 50
Get-Content C:\mourn\mourn-web\deploy.log -Tail 20
```

## What lives where

```
C:\mourn\mourn-web\
  current\                  junction -> releases\<live tag>; pm2 runs current\index.js
  releases\<tag>\           one immutable bundle per release (index.js, server\, client\, ...)
  deps\<packageHash>\       shared node_modules, installed with npm ci from the bundle lockfile
  downloads\<tag>\          downloaded tarball + checksum
  dist\ssr backup\          copy of the bundle that was live BEFORE the last deploy
  deployed.json             tag / commit / sha256 / deployedAt / previous release
  deploy.log                append-only log
  gh-token.txt              the PAT (your file, see ACL note above)
```

- `node_modules` is installed **once per `package.json` content hash** and linked
  into each release with a junction, so unchanged dependencies cost nothing and a
  rollback still runs against the tree its build was pinned to.
- `--keep` (default 3) controls how many old bundles and dependency trees survive
  pruning; the live release and the one it replaced are always kept.
- `deployed.json` + `deploy.log` answer "what is live and what happened".

## Pre-deploy backup (every deploy)

Before the `current` pointer moves, whatever is live at that moment is copied to
`C:\mourn\mourn-web\dist\ssr backup\` (`--backup-dir` to put it elsewhere). Every
deploy refreshes it, so it always holds the build that was serving before the most
recent attempt — including attempts that then failed their health check.

- `node_modules` is not copied: the snapshot gets a junction to the same pinned
  dependency tree, and the pruner keeps that tree for as long as the snapshot
  references it.
- `BACKUP_INFO.json` inside it records the tag, commit and timestamp it came from.
- A first deploy has nothing live to copy and logs `skipped the pre-deploy backup`.

Putting it back by hand:

```powershell
# preferred: redeploy the tag the backup came from (checksum-verified, tracked)
node C:\mourn\mourn-web\mourn-web-deploy.mjs --tag <tag from BACKUP_INFO.json> --force

# or run the copy directly
pm2 delete mourn-ssr
pm2 start "C:\mourn\mourn-web\dist\ssr backup\index.js" --name mourn-ssr --cwd "C:\mourn\mourn-web\dist\ssr backup"
```

## Failure behaviour

- **Checksum mismatch** → nothing is swapped; the live release keeps serving.
- **Unpack / `npm ci` failure** → same; the swap has not happened yet.
- **Restart or health-check failure** → `current` is re-pointed at the previous
  release, pm2 is restarted on it, and the tick exits 1 with an `ERROR` line.
- **No new release** → silent no-op. An explicit `--tag` run is never suppressed.
- **Two runs at once** (watch + manual) → a lock file makes the second one skip.

## Requirements / notes

- Node 18+ on the box (already there for the backend and for the SSR server
  itself), `pm2`, and `tar.exe` (Server 2019+ / Win10 1803+, in System32).
- `npm` must be on PATH for the box account, because runtime dependencies are
  installed there — the bundle ships `package.json` + `package-lock.json`, not
  `node_modules`.
- Release assets only exist for tags published after this change, so rollback can
  only reach the first web-enabled tag.
- The build itself never runs on the box: it happens in CI with the same pinned
  toolchain as the desktop release.

## Build-time configuration (your local `.env` vs CI)

The bundle is built in CI, so anything the frontend needs at build time has to exist
there — but it is a short list, and it is already wired:

- The SSR server reads **no environment at runtime** (`dist/ssr/index.js` and
  `server/server-entry.js` contain zero `process.env` reads). Nothing from `.env` is
  needed on the box; `deployed.json` + pm2 are the whole runtime story.
- What *is* needed is the `VITE_*` set, because those are compiled into the client
  bundle: `VITE_API_BASE`, `VITE_WS_BASE` (both hardcoded to `https://mourn.bio` in
  the workflow), `VITE_CAP_API_ENDPOINT` and `VITE_KLIPY_API_KEY`.
- Those live in the repo's **Actions secrets** (`VITE_CAP_API_ENDPOINT`,
  `VITE_KLIPY_API_KEY`), which is the CI equivalent of your `.env`. The workflow reads
  `secrets.X || vars.X` and fails early with a named error if a required one is empty,
  so an empty value can never be silently baked into a release again.
- `VITE_DISCORD_RPC_CLIENT_ID`, `VITE_TAURI_WS_ATTESTATION` and `VITE_HCAPTCHA_SITEKEY`
  are desktop-only or unused in `src/`, so the web build does not pass them.
- Static assets need no special handling: everything under `public/` and `src/assets`
  is committed, and Quasar copies `public/` into `dist/ssr/client` as part of the
  build — the tarball therefore carries the exact same files your local build does.

If you ever add a new `VITE_*` that the web build needs, add it as an Actions secret
and to the `Verify build-time configuration` step in `web-release.yml`; otherwise it
would ship empty.

## If SSH is ever opened on the box

Then the pull loop can be replaced with a push deploy (rsync `dist/ssr` from the
Action, `pm2 restart` over SSH) and the updater process removed. The assets that
`web-release.yml` publishes stay exactly the same, so nothing about CI would
change.
