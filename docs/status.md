# Project status

## Current state

Phases 0–2 are implemented and independently verified by the main agent after
each phase's implementing agent completed its work. Final static, unit, real-SSH,
browser, backup, capacity, and HTTPS Docker checks passed. This is a single-instance SSH workspace;
SFTP and additional protocols remain future milestones.

## Milestones

- [x] Phase 0: foundation, agent guidance, security, SSH proof of concept
- [x] Phase 1: saved profiles, credentials, host trust, terminal workflow
- [x] Phase 2: workspaces, MultiExec, reattachment (independent main review passed)

## Implemented

- pnpm/TypeScript monorepo, shared Zod contracts, generic extension ports,
  composition root, lint import boundaries, Prettier, CI and Docker tooling.
- PostgreSQL/Drizzle repositories and versioned transactional migrations for
  users, web sessions, profiles, credentials, trust, folders, workspaces,
  preferences and audit metadata, with owned folder/workspace CRUD and restore.
- Hidden-password administrator bootstrap, Argon2id local authentication,
  opaque cookie sessions, CSRF, exact origins, ownership checks, login/connect
  throttling, web-session expiry/logout cleanup and secret-redacted logs.
- Deny-default CIDR/port/DNS policy, mapped-address normalization, validation of
  every DNS result and approved-IP dialing.
- AES-256-GCM credential store with nonce freshness and ownership/ID binding.
- Real SSH adapter, mandatory pre-auth host verification, explicit TOFU prompt,
  strict/mismatch blocking, session-only authentication, PTY I/O/resize,
  keepalive, lifecycle cleanup, bounded output/input and ordered socket events.
- Explicit modern SSH transport allowlists, RSA SHA-2 authentication signing
  guards and DSA rejection. RSA public-key trust blobs retain their standard
  format; no legacy algorithm override is exposed in the MVP.
- Classic Light/Dark desktop shell, validated command-style Quick Connect (including
  bracketed IPv6), owned profile CRUD, ephemeral-to-saved conversion, encrypted
  credential management with explicit opt-in, manual host-key import/list/remove,
  persisted chrome/sidebar/terminal preferences and independent terminal palettes.
- Real plain/encrypted OpenSSH key authentication; encrypted saved keys remain
  on the server and receive session-only passphrase challenges. Passphrases are
  stripped before credential persistence. Server-side reconnect settings/reference
  retention revalidates policy and prompts again for session-only secrets.
- Structured REST/socket authentication invalidation restores the sign-in screen
  on expired login and treats already-expired logout as local cleanup. Delayed
  old-login responses cannot invalidate a newer login; terminal expiry remains
  distinct from web authentication expiry.
- Bounded in-flight creation leases cancel DNS-awaiting connections at logout.
  Frontend async results are scoped to their login; terminal disposal flushes
  pending output acknowledgements and late closed-terminal output is discarded.
- Compact terminal controls for scrollback search and clipboard, safe multiline/
  large paste confirmation, and registered capability-driven SSH UI.
- Session sidebar resizing/collapse, terminal tabs, xterm runtime registry, browser
  reattachment scaffolding, safe remote links and disabled OSC 52 clipboard access.
- Nested folder CRUD with owned parent/profile references, cycle rejection and
  transactional relocation of children/profiles on folder deletion. Descendant
  group launch allocates attachable IDs while limiting active handshakes to four.
- Owned workspace CRUD, versioned validated layouts, stable entry IDs, ordered
  background tabs with null panes, active entries and unique visible panes.
  Serialized restore reuses surviving entries and reports missing profiles
  individually; saving binds existing live sessions separately from saved layouts.
- Fixed one/two/four-pane layouts, draggable tabs, pane swaps/movement, context
  actions, middle-click close, keyboard cycling, temporary pane maximization and
  xterm runtime preservation across rearrangement.
- Centralized explicit MultiExec targets, selected/excluded pane styling, target
  counts, select-all/none, sensitive input and temporary single-pane mode.
  Multiline/large/multiple-target paste previews and revalidates targets. Host and
  authentication prompts turn broadcast off and block background terminal input.
- Immediate browser offline input suspension and online reconnect; detached leases
  retain SSH for ten minutes, reattachment reauthorizes controllers, input is never
  replayed, and slow-consumer disconnects expose a manual browser reconnect action.
- Sequenced replay bounded to 1 MiB/4096 frames, encoded as one binary attachment
  to respect Socket.IO parser limits; gap resets and truncation notices remain.
- Quick Connect safe profile drafts preserve policy across reload; promotion binds
  an owned matching profile to the same live session so workspace save includes it.
- Configurable 120/user/minute attempt rate, 32 concurrent session default,
  aggregate protected lifecycle/attempt/error/reconnect/trust/lag/memory metrics,
  metadata-only session and broadcast activation audit events, and registered
  implemented clipboard/search tools gated by capabilities.
- Disposable SSH/PostgreSQL fixtures and non-root application deployment behind
  Caddy HTTPS, private PostgreSQL and infrastructure subnet denial.

## Verified checks (2026-10-13 client date)

- `pnpm install`: successful with Node.js 24.21 and pnpm 10.34.7.
- `pnpm typecheck`: all three packages passed.
- `pnpm lint`: passed, including dependency-boundary rules.
- `pnpm test`: 35 unit/security/lifecycle tests passed; 10 real-SSH tests and
  1 backup test explicitly skipped in the default suite. Includes main-agent
  policy/cipher/import-boundary review, frontend stale-response/ACK regressions
  and expired-authentication/logout recovery checks.
- `pnpm build`: shared/server TypeScript and Vite frontend succeeded. Vite reports
  a bundle-size warning for the initial combined terminal/application bundle.
- `docker compose -f tests/compose.yaml up -d --build --wait`: fixture services
  healthy on project-specific ports; other Docker workloads untouched.
- `pnpm test:integration`: 10 real OpenSSH/HTTP/WebSocket scenarios passed,
  including origin/CSRF/target rejection, TOFU before authentication, PTY resize
  and output, stale-prompt rejection, close cleanup, FIFO keystroke burst,
  structured authentication failures, plain/encrypted/saved key authentication,
  passphrase-only challenges, fresh reconnect prompts/settings, imported strict
  trust, real key mismatch, pending-handshake cancellation, cross-user REST/socket
  isolation, preference persistence, explicit web-auth expiry notification and
  structured handshake rejection, DTO secrecy and captured Pino log redaction.
- `pnpm test:e2e`: 6 scenarios passed across Chromium, Firefox and WebKit:
  login, both-theme screenshots, trust/password prompts, terminal command I/O,
  saved credential opt-in and profile CRUD, independent preferences across reload,
  terminal search, saved-profile reconnect/disconnect, empty browser storage and
  logout. Main independently reran all six after credential-deletion and
  expired-authentication fixes; all passed (48.6 seconds).
  Screenshots are in `test-results/`.
- `pnpm test:backup`: 1 isolated PostgreSQL dump/restore scenario passed, including
  migration idempotence, matching-master-key decryption and wrong-key rejection.
  Main independently authored and executed this check.
- Main independently verified the Docker application image builds successfully
  with Node 24 and the explicit pnpm bootstrap.
- `pnpm format:check`: passed. Automatic fixture key preparation is in CI.

## Phase 2 verified checks (2026-10-13 client date)

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: passed after final product
  changes. All three new Phase 2 test files also passed explicit strict TypeScript.
- `pnpm test`: 51 unit/security/lifecycle tests passed, including 16 Phase 2
  scenarios for four-handshake concurrency/cancellation, layout validation,
  folders/restore, selective targets, paste cancellation/target changes,
  sensitive/single-pane routing, offline loss, and bounded input.
- `pnpm test:integration`: all 13 real-SSH HTTP/WebSocket scenarios passed,
  including eight-session restore/reuse, missing-profile partial restore, nested
  groups/ownership/cycles/deletion, high-output bounded single-attachment replay,
  strict Quick Connect promotion across browser attachment and fresh reconnect.
- `pnpm test:e2e`: all 12 browser scenarios passed across Chromium, Firefox and
  WebKit (1.9 minutes), including eight DUTs/four visible panes, selective two-target
  input, native paste confirmation/cancellation, sensitive input, offline input
  discard, original-ID reload/reattachment, and live Quick Connect/profile/workspace
  conversion. Six masked visual baselines compare both themes with selected and
  excluded panes. Unmasked screenshots are in `test-results/`.
- Final keyboard regression rerun: `pnpm test:e2e` passed all 12 scenarios
  (2.0 minutes) across all three engines after refreshing six visual baselines.
  Alt+PageUp/PageDown cycles session IDs without sending any captured terminal
  input frames. Search/form fields and open dialogs keep their active session;
  even forced background terminal focus behind a dialog emits no shortcut input.
  Terminal autofocus respects open dialogs; Ctrl/Cmd+Tab remains optional.
- `pnpm build`: passed after final product changes. Initial bundle remains
  730.30 kB (204.49 kB gzip) and Vite emits its bundle-size warning.
- Main agent's `pnpm test:performance`: 32 real SSH connections passed; connection
  33 was rejected with quota 429; command p95 9.54 ms; all original IDs reattached
  in 199.84 ms; 4 MiB output retained 1,047,659 bytes in one replay wire frame;
  measured test-process RSS increase 21.63 MiB; explicit close cleanup passed.
- CI runs shared/static/unit/build checks, all real SSH integration scenarios,
  isolated backup verification, and all three browser engines/visual comparisons.

## Final independent main-agent verification

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build`: passed.
- `pnpm test`: 54 passed; the 18 environment-dependent integration/load/recovery
  scenarios are deliberately skipped in the default unit run.
- `pnpm test:integration`: all 16 real OpenSSH/REST/WebSocket scenarios passed.
  The final three use isolated OpenSSH policy fixtures: modern RSA host/user
  SHA-2 signatures succeed with strict stored RSA trust; SHA-1-only host signatures
  fail before trust/authentication; SHA-1-only user authentication fails without
  a SHA-1 proof. Unit checks directly verify the signing fallback and DSA guards.
- `pnpm test:backup`: isolated database dump/restore and credential recovery passed.
- `pnpm test:e2e`: all 12 Chromium/Firefox/WebKit scenarios passed in 2.0 minutes,
  including keyboard input isolation and all six visual comparisons.
- Final `docker build -t web-ssh-workspace:verification .`: passed.
- `node tests/deployment.smoke.mjs`: passed using an isolated, loopback-only HTTPS
  deployment and a disposable SSH target. Verified the Caddy CA without disabling
  TLS validation; Secure/HttpOnly/SameSite cookies; built frontend serving; WSS/SSH
  command I/O; origin/target rejection; non-root/read-only/unprivileged execution;
  profiles, workspace, host trust and encrypted credential compatibility after
  restart; and absence of secret material from application logs. The review project,
  its volumes, networks and temporary secret files were removed automatically.
- Main reviewed the four-pane Classic Light screenshot and the capability/input,
  workspace ownership, layout/restore and composition boundaries.
- Final-policy `pnpm test:performance` rerun: 32 real SSH connections passed;
  connection 33 was rejected; command p95 10.42 ms; original-ID reattachment
  177.47 ms; 4 MiB output retained 1,047,659 bytes in one bounded replay attachment;
  test-process RSS increase 20 MiB; explicit close cleanup passed.
- Final Docker build and HTTPS smoke were repeated successfully after the SSH
  algorithm-policy correction. Disposable policy/deployment resources and the
  `web-ssh-workspace-fixtures` Compose services were removed after verification;
  unrelated running containers were preserved. Restart fixtures before rerunning
  integration, browser, backup or capacity checks.

## LAN deployment (2026-10-13)

- Production Compose is running at `https://192.168.10.160:8443`, bound to the
  host's `ens160` LAN address. App and PostgreSQL are healthy and have no published
  host ports. Existing unrelated Docker workloads remain running.
- SSH policy allows `192.168.10.0/24`, `192.168.3.0/24` and `192.168.4.0/24`,
  TCP 22, while retaining existing special
  address and Docker-infrastructure denials. The exact HTTPS origin remains
  mandatory; backend authentication/CSRF/socket checks were not relaxed.
- Deployment `.env`, a stable external master key and administrator credentials
  were generated without printing secrets. Username: `admin`; password handoff:
  root-only `secrets/admin-login.txt`. The public client trust certificate is
  `deploy/workspace-root.crt`.
- UFW now has four leading, scoped rules allowing these LANs TCP 8443 and denying other
  sources for this host IP/port. `WEBSSH-LAN` also restricts Docker DNAT traffic
  by original destination. The systemd firewall service is enabled and active;
  an explicit reload reapplied one jump without duplicates. Actual reboot/Docker
  restart was not performed to preserve unrelated workloads.
- Live verification passed: IP TLS with trusted CA and no SNI, built frontend,
  administrator login, secure cookie attributes, origin/target rejection, WSS
  attachment, and a real LAN SSH host-key handshake followed by explicit close
  without submitting credentials or saving trust. Captured app logs excluded
  the generated password, cookie and CSRF token.
- An isolated network namespace verified forwarded traffic: a synthetic source
  inside the configured LAN CIDR reached HTTPS readiness, while an outside source
  timed out and incremented the dedicated DROP counter. Both paths incremented
  the expected firewall rules. Temporary namespaces, interfaces, routes and probe
  containers were removed. A physical client browser still needs the CA imported.
- Caddy validation, Compose configuration validation and shell/service syntax
  validation passed. Pre-change configuration/UFW/iptables snapshots are in
  protected `deploy/backups/20261013T142149Z-lan/`.
- Additional-subnet update: persistent firewall configuration now supports a
  space-separated list, and both added subnets are live in UFW, `WEBSSH-LAN` and
  the app's SSH allowlist. Only the app was recreated to load the SSH policy;
  that restart ends live SSH connections but preserves saved data. The running
  policy accepts all three subnets on port 22 and rejects unlisted destinations,
  other ports and Docker infrastructure. Isolated forwarded-source HTTPS probes
  passed for all three LAN CIDRs and rejected an outside source. Configuration
  rollback snapshots are in `deploy/backups/20261013T143425Z-subnets/`.
- Operator password reset: applied the user-edited handoff password to the
  existing `admin` account using Argon2id. The transaction preserved the user ID,
  revoked one old web session and recorded metadata-only audit information. The
  app was stopped during the reset and restarted to release live resources.
  Verified new-password HTTPS login, authenticated profile access, logout,
  rejection of the logged-out cookie and absence of the new password/cookie/CSRF
  token in app logs. App and database are healthy. Protected pre-change database
  and matching-master-key backup: `deploy/backups/20261013T152645Z-admin-password/`.
  Editing `secrets/admin-login.txt` alone does not change the database password.

## Known limitations and remaining release checks

- No long-running production soak, production backup restore, manual Safari/Edge
  check or penetration review has run. Automated WebKit is not native Safari.
- Reconnect settings are retained for the current web lease, capped at 128/user
  and 4096/instance. Missing saved credential references fail explicitly until
  the user selects a replacement.
- A backend restart ends live connections. The MVP remains one application
  instance; custom grids/eight or sixteen visible panes, SFTP, advanced SSH,
  team identity/RBAC, vaults and other protocols remain future milestones.
- Saved secret strings and ssh2 copies cannot be reliably zeroized in JavaScript.
  The external master key must stay stable; credential key rotation is not provided.
- Performance measurements are from disposable local fixtures, not guarantees for
  production networks or remote DUT latency. Screenshot baselines are Linux/engine
  specific and mask terminal content plus the unique test username.

## Next

The agreed Phases 0–2 MVP is complete and its LAN deployment is running. Import
the client TLS CA and follow README.md for login and operations. Phase 3 SFTP is
the next product milestone.
Later features must extend the registered protocol/tool capabilities, shared validated
contracts, application services and domain ports described in `docs/architecture.md`.
Preserve host trust, ownership, target policy, bounded replay/input, and login-scoped
asynchronous responses when adding SFTP or productivity tools.
