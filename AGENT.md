# Web SSH Workspace — agent handbook

## Product

Implement the SSH-first Phases 0–2 in the project specification. Preserve the
compact desktop workspace, Classic Light/Dark themes, safe selective MultiExec,
and ten-minute browser reattachment. SFTP and additional protocols come later.

## Architecture

This is a modular monolith: `apps/web`, `apps/server`, `packages/shared`.
Transport handlers call application services; services depend on domain ports;
infrastructure implements those ports. Compose dependencies in the server
composition root. Domain code must not import Fastify, Socket.IO, Drizzle, or ssh2.
Register protocols explicitly and expose capabilities. Do not add pretend
implementations, runtime plugins, or protocol conditionals throughout the UI.
See `docs/architecture.md` for interfaces and data flow.

## Security invariants

- Authorize every resource and live-session operation, including socket events.
- Validate all DNS results against target policy, then dial a validated address.
- Verify SSH host keys before credentials are sent. Never replace changed trust.
- Preserve explicit modern SSH algorithm allowlists and RSA SHA-2 signing guards;
  do not inherit library defaults or silently enable legacy algorithms.
- Session-only credentials are the default. Never persist secrets in browser
  storage, public DTOs, logs, metrics, workspace layouts, or audit metadata.
- Saved secrets use authenticated encryption with an external master key.
- Bound replay, socket queues, payloads, authentication prompts, and live sessions.
- Never replay terminal input after reconnect. MultiExec resets OFF on disconnect.
- Explicit close, logout, and web-session expiry release associated SSH resources.
- Backend restart ends live sockets; database records are durable configuration.

## Commands

Use Node.js 24 LTS and pnpm 10. `pnpm install`, `pnpm dev`, `pnpm build`,
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, and
`pnpm test:e2e`, `pnpm test:backup`, and `pnpm test:performance`. Run `pnpm fixtures:prepare` once, then start disposable fixtures with
`docker compose -f tests/compose.yaml up -d --build --wait` before integration or
browser checks. Use `pnpm format` / `pnpm format:check` for authored source.
Load the local environment as described in README before runtime/database commands.
Database: `pnpm db:migrate`; administrator: `pnpm admin:create` (interactive).
Deployment and fixture commands are documented in README.md.
For final local deployment verification, build the `web-ssh-workspace:verification`
image and run `node tests/deployment.smoke.mjs`. It uses an isolated Compose project
and removes its own temporary resources; keep production secrets out of tests.

## Extending the project

Add schemas and capabilities to shared contracts first, implement a domain port
or protocol adapter, register it at composition, and expose capability-driven UI.
Use repository interfaces and versioned migrations for persistence changes.
Keep terminal renderers separate from saved layout state. Route all input through
the input controller, including future snippets. Avoid bypassing authorization,
credential storage, or target policy in a new adapter. Saved key passphrases
remain session-only; encrypted keys are decrypted on the server and prompt for a
passphrase without returning their private key. Reconnect sources contain settings
and references only, follow attachment leases, and are revoked on logout.
Register implemented workspace tools in `workspaceTools` with capability gates.
Typing, native paste, toolbar paste and future snippets must all use the shared
input controller. Explicit browser attachment and OPEN state are required;
MultiExec targets must be selected deliberately. Both navigator offline events
and transport loss suspend input immediately. Replay stays bounded; coalesce the
server ring into one binary attachment on the wire to respect Socket.IO parser
limits. Preserve terminal runtime IDs when rearranging panes. Quick Connect
conversion uses server-held profile drafts and owned live profile association;
never reconstruct sensitive connection settings from a partial display DTO.

## Validation and progress

Assign a subagent to implement each phase. The main agent independently reviews
the changes and verifies the phase before recording it as complete.

Run checks appropriate to each change; add meaningful security/lifecycle tests.
Keep lint import boundaries enabled. Record actual commands, results, limitations,
and remaining release gates in `docs/status.md` after meaningful milestones.
Distinguish implemented from verified. Do not claim browser, Docker, performance,
or security certification without executing the corresponding checks.
Update architecture documentation when interfaces or invariants change.
