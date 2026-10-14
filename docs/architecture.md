# Architecture

Web SSH Workspace is an SSH-first modular monolith. The only registered protocol
is SSH; capabilities for files, tunnels and desktop display remain false until
real implementations are added.

## Packages and dependencies

- `packages/shared`: Zod-validated REST/socket contracts, errors, lifecycle states,
  capabilities, SSH profile settings and version-1 workspace layouts. No secrets
  belong in public profile/session/credential DTOs.
- `apps/server/src/domain`: ports, errors and ownership authorization. No framework,
  database, SSH-library or application imports.
- `apps/server/src/application`: web authentication, host trust, SSH session
  creation, catalog configuration and the live session manager. Services depend on ports.
- `apps/server/src/infrastructure`: PostgreSQL/Drizzle repositories, authenticated
  credential encryption, network policy, local identity and the ssh2 adapter.
- `apps/server/src/transport`: Fastify REST and Socket.IO validation/adaptation.
  No table/ssh2 imports. `composition.ts` wires concrete dependencies.
- `apps/web/src/lib`: API client, transport, input controller, in-memory workspace
  state and terminal runtime registry. Components render and coordinate these
  responsibilities. Terminal instances are kept outside saved layout/state.

ESLint restricts imports across these boundaries, including nested relative paths.
Infrastructure repositories validate DTO output and explicitly project database
records; schema validation never exposes password hashes, ciphertext or public
key bytes accidentally.

## Extension ports

`ProtocolAdapter<TContext>` accepts an adapter-specific context extending the
common approved target/settings/abort signal. `SshConnectContext` adds SSH host
verification and authentication hooks. `ProtocolConnection` exposes capabilities,
an optional `TerminalChannel`, and deterministic disposal; a later desktop
adapter need not implement a fake terminal. The session manager receives a
connector function and owns generic lifecycle/leases/output, while
`SshSessionService` supplies SSH-specific orchestration. Extend the shared
registered-profile union and composition registry when implementing another
protocol, then register matching capability-driven UI.

`IdentityProvider`, `AuthorizationService`, `TargetPolicy`, `CredentialStore`,
`SessionRegistry`, and repositories isolate replaceable dependencies. Future
vault, OIDC, RBAC, worker or file-channel implementations should extend these
boundaries without accessing infrastructure directly from HTTP handlers.

## Connection flow

1. Authenticate the browser, validate CSRF/exact origin and the request schema.
2. Resolve an owned profile or ephemeral SSH settings; enforce attempt/concurrency
   limits. Validate every DNS result against allowed/denied CIDRs, port policy
   and optional DNS suffix policy; dial the validated numeric address.
3. Allocate the session ID before starting handshake. Attach the browser to this
   ID; pending prompts are retained and delivered on attachment.
4. ssh2 verifies the server-observed key before authentication. Known-key mismatch
   blocks; strict unknown keys block; TOFU requires a session/request-bound user
   decision. An accepted saved key cannot overwrite concurrent different trust.
5. Obtain session-only material or an owned encrypted credential, authenticate,
   allocate the PTY and open a shell. Release application references to ephemeral
   material when connection establishment ends.
6. Forward ordered input and sequenced binary output through an authorized
   controller. Socket operations authenticate again for every event.

Passwords/keys are never included in session DTOs, browser storage or logs. Saved
material uses AES-256-GCM with fresh 96-bit nonces and owner/credential-ID AAD.
The master key lives outside the database. JavaScript strings and ssh2 internal
copies cannot be reliably zeroized; avoid claims of guaranteed memory wiping.

## Lifecycles and bounded transport

- Default instance limit: 32 live SSH sessions; attempts: 120/user/minute (configurable).
- A browser controller can be replaced by another authorized attachment; the old
  controller is notified and cannot send input. A new web login rebinds the live
  session's web-session lease and expiry to the attaching authenticated session.
- Disconnect retains SSH for 600 seconds. Close, logout, web expiry, prompt
  timeout, SSH failure and shutdown release resources. A five-second sweeper
  revokes expired web sessions; SSH leases also have exact expiry timers.
- Replay retains at most 1 MiB **and 4096 frames** per session. Frames are sliced
  to 16 KiB. Gap/reload replay resets the terminal and reports truncation.
- Live socket output has 256 KiB/512-frame acknowledgement bounds; one bounded
  replay may be queued per socket. Slow consumers disconnect after timeout.
- Socket events have a 128-event/1 MiB FIFO and a 500-event/second limit. Each
  event is authenticated and executed in arrival order, so asynchronous database
  checks cannot reorder terminal keystrokes. Queued work is discarded on socket
  disconnect.
- Frontend connected input uses ordered emission with a 256 KiB/128-frame pending
  bound. Input is discarded while disconnected; disconnect clears Socket.IO's
  send buffer. No keystrokes are replayed after reconnect.
- SSH input accepts stream backpressure internally; a 256 KiB writable queue cap
  prevents unbounded remote-input buffering. A false port result means rejected
  input rather than Node's ordinary accepted-but-backpressured write result.
- Closed/failed status entries remain for at most 60 seconds, without replay
  bytes or live resources. Backend restart ends live SSH connections.

## Persistence and operations

PostgreSQL stores users, web sessions, credentials, trust, profiles, folders,
workspaces, preferences and audit metadata. Drizzle implements repositories;
versioned SQL migrations are applied transactionally under a PostgreSQL advisory
lock and recorded in `schema_migrations`. Never edit an applied migration; append
one for changes. Saved workspace layouts contain entry/profile IDs and pane
assignments, never live session IDs or secrets.

Docker Compose exposes Caddy only, with HTTPS on 8443 by default. PostgreSQL and
the non-root application are private. The application infrastructure subnet is
explicitly denied for SSH. Target policy is deny-by-default until configured.
`HTTPS_BIND_ADDRESS` selects the host interface for the published HTTPS port.
Caddy uses the configured hostname as default SNI for IP clients. The current
LAN deployment also applies scoped UFW and Docker `DOCKER-USER` source rules,
maintained by a dedicated systemd service without changing other service rules.
Metrics are administrator-protected; liveness/readiness are public operational
endpoints. Logging uses Pino redaction and excludes request bodies and terminal
input. SFTP, custom grids, team administration, protocol plugins and distributed
session ownership remain future work.

## Phase 1 configuration and authentication

`CatalogService` validates owned credential/folder references before writing a
profile. REST parses shared request and response schemas; the browser validates
configuration, login and authentication-prompt responses with the same contracts.
Credential APIs return only IDs, names and types. Saving a private key strips its
passphrase before AES-GCM encryption. The SSH adapter uses `ssh2.utils.parseKey`
to decrypt a key using transient material. For encrypted saved keys it requests a
passphrase-only, session-bound prompt; private-key bytes never travel back to the
browser. Authentication prompts are bounded and clear when a session closes.

Host-key import accepts an OpenSSH public-key line and validates wire framing,
computing algorithm/fingerprint on the server. Existing trust cannot be replaced
through import. Removal/import/mismatch decisions produce audit records. The
server compares full key bytes during handshake before obtaining authentication.

Reconnect preserves owned profile references or immutable ephemeral settings,
never passwords, private keys or passphrases. Its metadata follows web leases on
attachment; logout/expiry/shutdown revoke corresponding sources. Storage is bounded
to 128 sources per user and 4096 total. Reconnect closes the old transport, creates
a new session, resolves policy again, and prompts for session-only material. The
session DTO includes initial terminal options so runtime scrollback remains correct
across reload. Saved-profile reconnect uses current profile settings.

Frontend protocol descriptors register SSH capabilities explicitly. Configuration
dialogs, catalog store, terminal controls, and runtime registry separate durable
configuration from terminal instances. Theme/sidebar/defaults persist per user;
font, cursor and terminal palette remain independent of application chrome.
Paste interception uses the shared input controller and confirms multiline, large,
and multiple-target paste with a bounded content preview and selected target names.

In-flight connection creations hold bounded reservation leases before asynchronous
profile/target resolution. Logout or shutdown cancels pending leases; the service
asserts validity after DNS and immediately before allocation, preventing a late
connection from escaping logout cleanup. Only pending reservations are retained.
Frontend operations capture their login identity and CSRF token before awaiting
responses. Obsolete responses cannot restore another user's configuration or tabs.
Terminal runtimes retain pending output acknowledgements and flush them before
disposal; output arriving for a closed/missing session acknowledges immediately
without creating a hidden terminal. This preserves socket cleanup while keeping
output backpressure for live consumers.

Authentication expiry is reported with an explicit `auth:invalidated` socket event
and structured handshake-error data. Terminal lifecycle errors can share
`SESSION_EXPIRED`; they do not invalidate the browser login. The API client raises
`ApiRequestError` with HTTP status and validated error data, invalidating only the
login token/revision that originated the request. The application composes a
local cleanup listener that clears terminals, catalog, prompts and authenticated
state, restoring sign-in even when logout already returns 401. Network/server
failures retain the current login and show the error.

## Phase 2 workspace and operational boundaries

`WorkspaceService` coordinates durable catalog entries with live sessions. Restore
is serialized per owner/workspace, reuses surviving matching profile/entry sessions,
and reports failures per entry. Saved layouts allow null panes for background tabs;
visible panes are unique and bounded by the selected one/two/four-pane layout.
Existing live sessions are bound through a separately authorized association API,
so saved layouts never contain runtime session IDs. Deleted profiles stay explicit
in saved layouts and fail individually on the next restore.

Folder mutations are serialized per owner to prevent concurrent cycle creation.
Parent and profile references must belong to the caller. Deleting a folder moves
its direct children and profiles to the root in a PostgreSQL transaction. Launching
a folder includes descendant profiles. `ConnectionGate` limits active SSH
handshakes to four, including authentication/trust prompts; allocated IDs remain
attachable while queued. Cancellation removes queued connections immediately.

Connection attempts default to 120 per user/minute (`SSH_ATTEMPTS_PER_MINUTE`),
independent of the default 32 concurrent session limit. Protected metrics expose
aggregate active/detached sessions, attempts, failures, reconnects, attachments,
host-key mismatches, event-loop delay and memory. Lifecycle audit events contain
session IDs, state and optional error codes, never terminal bytes or credentials.

The frontend workspace model stores layout, ordered session DTOs, stable entry
mappings and explicit browser attachment IDs; xterm instances remain in a separate
runtime registry. `InputController` is the sole input fan-out path. It snapshots
then revalidates paste targets, preserves per-target bracketed-paste modes, and
requires OPEN plus a live browser attachment. Authentication and host trust
prompts block all background terminal input and reset broadcasting. Sensitive
Input turns broadcast off; single-pane mode preserves the selected group while
suspending broadcast. Browser offline events disconnect immediately; online
events reconnect and reauthorize attachments. Disconnected input is discarded.
Registered protocol descriptors and real clipboard/search tool descriptors expose
only implemented capabilities.

Socket replay coalesces the bounded ring into one binary wire attachment carrying
the final sequence. Socket.IO decoders reject excessive binary attachments; never
relax decoder limits to send thousands of frames. The registry retains original
frame sequence granularity for incremental replay and gap detection.

Quick Connect profile conversion obtains a server-held, secret-free draft, then
associates the saved owned matching target with the same live session ID. Its
reconnect source changes to the saved profile reference. Workspace save can then
include that live session. Application dependencies and process monitoring are
created in the composition root; HTTP handlers only invoke services/read snapshots.
Broadcast activation audit records enabled state and target count, without input.

## SSH algorithm defaults

The SSH infrastructure adapter replaces upstream transport defaults with explicit
modern allowlists: Curve25519/ECDH and SHA-2 fixed-group KEX, Ed25519/ECDSA/RSA
SHA-2 host signatures, AES-GCM/ChaCha20-Poly1305/AES-CTR, and SHA-2 MACs (ETM
preferred). RSA-SHA1, DSA, SHA-1 KEX/MACs, CBC, RC4 and MD5 are disabled; no legacy
override is implemented. RSA public-key blobs retain their standard `ssh-rsa`
format in trust storage, independent of the negotiated SHA-2 signature algorithm.

ssh2's public authentication API does not expose a signature-policy option.
A per-connection parsed RSA key's public signing hook refuses SHA-1 and implicit
fallback before signing, returning the Error result supported by ssh2. SHA-256
and SHA-512 remain supported. A server lacking RSA-SHA2 advertisement may receive
an unsigned RSA key probe, but no RSA-SHA1 authentication proof is produced.
DSA user keys are rejected. Later algorithm configuration must preserve these
secure defaults and require explicit legacy opt-in.
