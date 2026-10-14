# Web SSH Workspace

A self-hosted browser SSH workspace with compact desktop chrome, Classic Light
and Dark themes, explicit host-key verification, and a backend-owned terminal.
The approved MVP covers Phases 0–2; see [current status](docs/status.md).

Read [AGENT.md](AGENT.md) before contributing. Architecture and extension
boundaries are documented in [docs/architecture.md](docs/architecture.md).
The [specification](web-ssh-workspace-project-spec.md) includes later SFTP and
productivity features.

## Workspace keyboard controls

Use **Alt+PageDown** to switch to the next terminal tab and **Alt+PageUp** for the
previous tab, including while typing inside a terminal. These keys are captured
locally and do not send escape sequences to SSH. Cycling follows the current tab
order. Ctrl/Cmd+Tab and Shift+Ctrl/Cmd+Tab are also supported when the browser
allows the page to handle them.

Terminal cycling is suspended while any application dialog is open and while
editing ordinary inputs, textareas, selects, or editable content. Authentication,
preferences, credential dialogs, and search fields retain keyboard focus.

## Local development

Requirements: Node.js 24 LTS, pnpm 10.34.7, Docker with Compose.

```sh
pnpm install
cp .env.example .env
openssl rand -base64 32
```

Put the generated key in `CREDENTIAL_MASTER_KEY` in `.env`. This key must remain
stable to read saved credentials. Load the environment and start PostgreSQL:

```sh
set -a
. ./.env
set +a
docker compose -f compose.dev.yaml up -d --wait
pnpm db:migrate
pnpm admin:create
pnpm dev
```

The administrator CLI reads a hidden password from the TTY; it requires at least
12 characters. Open `http://localhost:5173`. Only local development uses an
insecure HTTP cookie; production requires HTTPS and Secure/HttpOnly cookies.

All SSH targets are denied until you set `ALLOWED_CIDRS`; allow only your lab
networks and approved ports. Deny rules override allows. Configure
`DENIED_CIDRS` for application/database infrastructure and metadata/loopback
addresses. Optional `ALLOWED_DNS_SUFFIXES` are comma-separated domains; every DNS
address must independently pass CIDR policy. The backend dials the validated
address, preventing a second DNS resolution from bypassing policy.

## Test fixtures and verification

Fixtures use their own Compose project and loopback-only ports 22222 (SSH) and
55433 (PostgreSQL), without modifying other Docker workloads.

```sh
pnpm fixtures:prepare
docker compose -f tests/compose.yaml up -d --build --wait
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm test:backup
pnpm test:performance
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:e2e
```

Integration configuration explicitly permits `127.0.0.1:22222` for the disposable
SSH target. The fixture login is `lab` / `fixture-password`; never reuse it in
real deployments. Playwright seeds `browser-admin` / `browser-test-password` in
the fixture database only and starts dedicated backend/Vite processes. Screenshots
and failure traces are saved in `test-results/`. Unit tests skip real SSH unless
`RUN_SSH_INTEGRATION=1`. Optional `TEST_DATABASE_URL` overrides the fixture database.

`pnpm fixtures:prepare` creates an authorized OpenSSH key and an encrypted copy
of the same key in ignored `tests/.fixture-key/`. Their passphrase is
`fixture-key-passphrase`; these are disposable test credentials. Run preparation
before starting fixtures so SSH imports the public key. CI does this automatically.
`pnpm test:backup` verifies PostgreSQL dump/restore and credential recovery using
isolated databases, including wrong-master-key rejection.

Run `docker compose -f tests/compose.yaml down -v` to remove only these disposable
fixtures. Format authored source with `pnpm format`; use `pnpm format:check` to
verify style. Applied migrations are immutable: add a new numbered migration.

## Docker deployment

Create a deployment `.env` (do not use the development HTTP origin):

```dotenv
POSTGRES_PASSWORD=replace-with-a-long-random-password
WORKSPACE_HOST=localhost
APP_ORIGIN=https://localhost:8443
HTTPS_PORT=8443
HTTPS_BIND_ADDRESS=0.0.0.0
ALLOWED_CIDRS=192.168.10.0/24
ALLOWED_PORTS=22
CREDENTIAL_MASTER_KEY_PATH=./secrets/credential-master-key
```

Provision the external credential master key and build/start:

```sh
mkdir -m 700 secrets
openssl rand -base64 32 > secrets/credential-master-key
chmod 444 secrets/credential-master-key
docker compose up -d --build --wait
docker compose exec app node apps/server/dist/admin.js
```

The protected `secrets` directory restricts host traversal; the mounted file must
be readable by the non-root container user. Keep it out of source control and
back it up securely. Migrations run before the application starts. Open the exact
configured `APP_ORIGIN`; origin checks intentionally reject different hostnames
or ports. Caddy uses its internal CA: export and trust its root certificate on
clients, or replace `tls internal` with your organization's TLS configuration.

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./workspace-root.crt
```

The Compose infrastructure network is `172.29.241.0/24` and is automatically
added to the SSH deny policy. Choose a non-conflicting subnet and update that deny
rule together if this range overlaps your network. Only Caddy publishes a port.
The app runs as `node`, has a read-only filesystem, dropped capabilities and no
privileged mode. Deploy on a private LAN/VPN.

## Current LAN deployment

This host is configured at **https://192.168.10.160:8443**, with HTTPS bound to
`192.168.10.160`. Browser access and SSH targets are allowed in
`192.168.10.0/24`, `192.168.3.0/24` and `192.168.4.0/24`; SSH uses TCP port 22.
Reserve this address in DHCP to keep the URL, TLS identity and firewall consistent.
The exact IP origin is required for login, REST mutations and WebSocket attachment.
Caddy supplies a default TLS server name so IP clients without SNI can connect.

The administrator username is `admin`. Its generated password is in root-only
`secrets/admin-login.txt`; retrieve it locally with `sudo cat` and keep it private.
This file is a handoff record: editing it or restarting the app does not change
the database login password. An operator reset must update the stored Argon2id
hash, revoke that user's web sessions and release their live SSH resources.
Import the public CA certificate `deploy/workspace-root.crt` into client trusted
root certificates before using the browser. PostgreSQL and backend ports remain
private to Docker. Deployment secrets are in the ignored, mode-600 `.env` and
protected `secrets/` directory; keep the master key and database backup together.

UFW permits TCP 8443 from these three subnets to the host LAN address and denies
other sources for that address/port. Docker DNAT bypasses UFW's INPUT rules, so
`web-ssh-lan-firewall.service` also installs a dedicated `WEBSSH-LAN` chain in
`DOCKER-USER`, matching the original published IP/port. Other published services
and firewall rules are preserved. The service is enabled at boot and follows
Docker service restarts. Its configuration is `/etc/default/web-ssh-lan-firewall`,
with the space-separated `LAN_CIDRS` list. The app's `.env` uses a comma-separated
`ALLOWED_CIDRS` list for SSH destinations. Source templates are in
`deploy/lan-firewall.sh` and
`deploy/web-ssh-lan-firewall.service`.

When changing the LAN address/subnets/port, update `.env`, the scoped UFW
rules, and `/etc/default/web-ssh-lan-firewall` together, then recreate the proxy/app
and reload the firewall service. Stop Caddy before removing its access restrictions.
Reapply the Docker rule after manual firewall changes with
`sudo systemctl reload web-ssh-lan-firewall.service`. Pre-change configuration
and firewall snapshots are protected in `deploy/backups/20261013T142149Z-lan/`.

## Backup, restore and operations

Back up PostgreSQL plus the external master key as a protected pair:

```sh
docker compose exec -T db pg_dump -U workspace workspace > workspace-backup.sql
```

To restore into an empty database with the matching master key, stop the app,
restore SQL, then start it. Live SSH connections end on restart; saved records
remain durable.

```sh
docker compose stop app
docker compose exec -T db psql -U workspace workspace < workspace-backup.sql
docker compose start app
```

Changing the master key without re-encryption makes saved credentials unreadable.
`/health/live` and `/health/ready` support operations; `/api/metrics` requires an
administrator login. See `docs/status.md` for validation evidence and release
checks that have not yet been performed.

## Saved SSH workflow

Use **New session** to save profiles, or **Save** on a Quick Connect terminal to
convert it. Profiles reference credentials without exposing secret contents.
Passwords and key passphrases default to session-only; credential saving requires
explicit opt-in in the credential manager. Saved encrypted keys remain on the
server and prompt for their passphrase on each connection. Deleting a credential
leaves explicit missing references; edit affected profiles to select a replacement.
Use **Host keys** to import an OpenSSH public key before a strict-policy connection.
Changed keys block connection; remove existing trust explicitly before accepting
a replacement. **Preferences** persists chrome, sidebar and terminal defaults;
terminal palettes are independent of chrome. **Disconnect** retains the tab;
**Reconnect** creates a fresh connection and prompts for transient secrets again.

## Workspace organization and extension

Folder launches include nested folders and start at most four SSH handshakes at a
time, including pending trust and authentication prompts. Saved workspaces retain
profile references, stable entries, tab order, active entry and one/two/four-pane
assignments. Background tabs use null pane assignments; saved definitions contain
no live session IDs or secrets. Restore reuses surviving matching sessions and
reports missing profiles independently. Folder deletion moves direct children and
profiles to the root.

Set `SSH_ATTEMPTS_PER_MINUTE` (default 120) independently from
`MAX_SSH_SESSIONS` (default 32). Detached sessions keep their remote connection for
`SESSION_GRACE_SECONDS` (default 600). A backend restart ends live connections.
Metrics include aggregate connection/lifecycle counts, event-loop delay and memory.

Future protocol and tool additions must follow the registered capabilities and
domain-port boundaries in [architecture](docs/architecture.md). Saved layout
changes require explicit versioned compatibility handling. Runtime terminals and
input remain outside durable configuration.

MultiExec starts off and requires explicit target selection. Single-pane input
keeps the group selection while directing input to the focused pane; Sensitive
Input switches broadcast off. Multiline, large and multiple-target paste requires
confirmation with a preview, and selection is checked again before sending.
Authentication prompts and browser disconnection block terminal input. The
application clears selections on disconnect and restore, and never replays input.
Use **Reconnect browser** after a server-forced slow-consumer disconnect. Browser
offline/online events suspend input and restart attachment automatically.

`pnpm test:performance` runs the isolated 32-session fixture benchmark, checking
quota rejection, command latency, original-session reattachment, high-output
bounded replay and cleanup. It writes measurements to `test-results/performance.json`;
Playwright runs may clean that directory. This local benchmark is separate from
a production soak test.

To reproduce the disposable HTTPS deployment check after building the image:

```sh
docker build -t web-ssh-workspace:verification .
node tests/deployment.smoke.mjs
```

Prepare the SSH fixture image first using the fixture commands above. This check
uses a unique Compose project, two free review subnets, temporary secrets, and
loopback port 18443. It verifies trusted TLS, secure cookies, WSS/SSH, policy,
container restrictions, restart persistence, and log redaction, then removes only
its own containers, volumes, networks, and temporary files. Existing deployments
and fixture data are preserved.

SSH transport and authentication use an explicit modern algorithm policy. Legacy
RSA-SHA1 host signatures, SHA-1 KEX/MACs, DSA, CBC, RC4 and MD5 are disabled.
RSA host/user keys remain usable with RSA-SHA2 signatures. Saved RSA host keys
still use the standard `ssh-rsa` public-key format; that format is distinct from
using a SHA-1 signature. Legacy policy overrides are reserved for Phase 5.
Integration checks create temporary OpenSSH policy fixtures from the already-built
SSH fixture image, publish random loopback ports, and remove only their own
containers and key/configuration directories.
