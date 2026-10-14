# Web SSH Workspace

> A self-hosted, browser-based remote terminal workspace for internal networks, inspired by the SSH-centric workflow of MobaXterm and optimized for engineers who manage many Linux servers, switches, routers, lab DUTs, and appliances from macOS, Windows, or any modern browser.

## 1. Project Status

**Status:** Proposed / Design phase  
**Primary deployment:** Private LAN or trusted VPN  
**Primary clients:** macOS, Windows, Linux, iPadOS, modern Chromium/Safari/Firefox browsers  
**Primary protocol:** SSH  
**Deployment model:** Self-hosted, Docker-first  
**Initial audience:** Single-user engineering lab; architecture should remain extensible to multi-user/team use

---

## 2. Executive Summary

Web SSH Workspace is a self-hosted web application that provides a MobaXterm-like terminal workflow through a browser. Its primary goal is not to reproduce every Windows-specific MobaXterm feature, but to provide the parts that are most valuable for remote engineering work:

- Multiple simultaneous SSH sessions
- Tabbed terminals
- 1, 2, 4, and custom split layouts
- Selective MultiExec / broadcast input
- Saved hosts, folders, groups, and workspaces
- SFTP file browsing and transfer
- SSH key and password authentication
- Host-key verification
- Jump hosts and SSH gateways
- SSH port forwarding
- Session reconnect and browser re-attachment
- Terminal search, logging, command snippets, and macros
- Optional persistent Linux shells with tmux
- Future support for Telnet, Serial, RDP, VNC, and other remote-access protocols

The browser does **not** create raw TCP SSH connections directly. Instead, it connects to an application backend over HTTPS and WebSocket. The backend owns the actual SSH connections and streams terminal input/output between the browser and target systems.

This architecture makes the application accessible from a MacBook without installing a native SSH client while preserving a multi-session workflow similar to MobaXterm.

---

## 3. Why This Project Exists

MobaXterm is highly effective on Windows because it combines terminal access, session management, SFTP, split panes, MultiExec, tunneling, and remote-access tools in one application. A Mac user can reproduce individual capabilities with Terminal, iTerm2, VS Code, Royal TSX, Termius, or other tools, but the workflow becomes fragmented.

This project aims to provide a single internal web workspace that can be opened from any authorized browser and immediately restore an engineering environment containing many remote sessions.

Example use cases:

- Open eight lab switches at once and arrange them in a 2 x 4 workspace.
- Broadcast `show` commands to a selected set of DUTs.
- Keep a Graylog server, build server, NAS, and lab routers available in separate tabs.
- Open an SFTP browser next to the SSH terminal for the active host.
- Save a complete project workspace and restore it with one click.
- Move between Windows and macOS without rebuilding the SSH session list.
- Reconnect the browser after a Wi-Fi interruption without immediately destroying backend SSH sessions.

---

## 4. Product Principles

### 4.1 SSH First

The project should first become an excellent SSH workspace before adding unrelated remote-access protocols.

### 4.2 Multi-Session First

The defining feature is not merely "SSH in a browser." The product should be optimized for engineers who operate several systems simultaneously.

### 4.3 Safe by Default

Because the backend can initiate network connections on behalf of a browser user, target validation, host-key verification, authentication, credential handling, and network access controls are core architecture requirements rather than optional hardening.

### 4.4 Browser Independent

A user should be able to move between macOS, Windows, Linux, and tablets without changing the remote workspace model.

### 4.5 Self-Hosted

The default deployment should not require an external SaaS service. All connection metadata, credentials, session information, and logs should stay inside the user's infrastructure.

### 4.6 Progressive Complexity

The first release should solve SSH workflow problems well. RDP, VNC, Serial, X11, collaboration, HA, and enterprise identity should be optional later capabilities.

### 4.7 MobaXterm Visual Familiarity

The default desktop experience should intentionally feel familiar to an experienced MobaXterm user. The product must provide a high-fidelity **MobaXterm-inspired compatibility theme** from the first usable release, including the overall information architecture, session tree, Quick Connect area, tab treatment, terminal-first workspace, sidebar behavior, and compact engineering-tool density.

This is a workflow and visual-language requirement, not a requirement to copy MobaXterm trademarks or proprietary visual assets. The implementation must use original CSS, original or open-source icons, and its own product name and logo.

---

## 5. Feature Validation Against MobaXterm

The following table identifies major MobaXterm-style capabilities and how they map to this project.

| Capability | MobaXterm-style behavior | Web feasibility | Planned status |
|---|---|---:|---|
| MobaXterm-inspired application theme | Familiar desktop chrome, session tree, Quick Connect, terminal tabs, compact tool layout, light/dark UI | Excellent | Phase 0/1 |
| SSH terminal | Interactive terminal | Excellent | Phase 1 |
| Multiple tabs | Many concurrent terminal sessions | Excellent | Phase 2 |
| Split view | 2/4 terminal panes | Excellent | Phase 2 |
| Selective MultiExec | Send input to selected terminals | Excellent | Phase 2 |
| Saved sessions | Save hostname, port, username, options | Excellent | Phase 1 |
| Session folders/groups | Organize lab/server groups | Excellent | Phase 2 |
| Launch a group | Open many saved sessions together | Excellent | Phase 2 |
| Quick connect | `ssh user@host` style entry | Excellent | Phase 1 |
| SFTP browser | Browse remote files with SSH session | Excellent | Phase 3 |
| Upload/download | Browser to remote host | Excellent | Phase 3 |
| Remote text editing | Edit remote text files | Good | Phase 3/4 |
| Terminal search | Search scrollback | Excellent | Phase 2 |
| Session logging | Save terminal output/transcript | Excellent | Phase 4 |
| Macros/snippets | Reuse common command sequences | Excellent | Phase 4 |
| SSH jump host | Connect through gateway/bastion | Excellent | Phase 5 |
| Local port forwarding | Local-style tunnel through gateway | Good through backend | Phase 5 |
| Remote port forwarding | Remote listener forwarded through SSH | Good | Phase 5 |
| Dynamic SOCKS forwarding | SOCKS proxy through SSH | Good | Phase 5 |
| SSH agent | Agent-backed authentication | Good but environment-dependent | Phase 5 |
| Password authentication | Password / keyboard interactive | Excellent | Phase 1/5 |
| Private key authentication | OpenSSH keys | Excellent | Phase 1 |
| Host-key verification | known_hosts / TOFU behavior | Excellent | Phase 1 |
| Telnet | Text terminal without SSH encryption | Excellent through backend | Phase 7 |
| Serial console | COM/USB serial access | Possible but deployment-dependent | Phase 7 |
| RDP | Graphical remote desktop | Good using Guacamole | Phase 7 |
| VNC | Graphical remote desktop | Good using Guacamole | Phase 7 |
| X11 forwarding | Native X application display | Poor fit for pure browser model | Experimental |
| Mosh | Resilient shell protocol | Possible but additional complexity | Optional |
| Local Unix shell | MobaXterm local Cygwin-like shell | Different model in browser | Optional container shell |
| Network tools | Ping, trace, scan, etc. | Possible from backend | Optional/admin-controlled |

### Scope Decision

The application should be positioned as a **Web MobaXterm-style SSH Workspace**. Its default compatibility theme should deliberately reproduce the familiar MobaXterm layout and interaction model at high fidelity, while avoiding a literal copy of proprietary branding, logos, bundled images, or icon artwork. Functional familiarity is a product requirement; trademark confusion is not.

---

## 6. Primary User Experience

### 6.1 Main Layout

```text
+--------------------------------------------------------------------------------+
| Web SSH Workspace                        Search        + New Session       User |
+----------------------+---------------------------------------------------------+
| Connections          |  DUT1 | DUT2 | Graylog | NAS | +                     |
|                      +---------------------------------------------------------+
| > ERP Lab            | +---------------------------+-------------------------+ |
|   DUT1               | | DUT1                      | DUT2                    | |
|   DUT2               | |                           |                         | |
|   DUT3               | | switch#                   | switch#                 | |
|   DUT4               | +---------------------------+-------------------------+ |
|                      | | DUT3                      | DUT4                    | |
| > Servers            | |                           |                         | |
|   Graylog            | | switch#                   | switch#                 | |
|   NAS                | +---------------------------+-------------------------+ |
|                      |                                                         |
| > Infrastructure     | [ MultiExec ON ] [DUT1] [DUT2] [DUT3] [DUT4]          |
+----------------------+---------------------------------------------------------+
| Files | Snippets | Transfers | Logs | Session Info                              |
+--------------------------------------------------------------------------------+
```

### 6.2 MobaXterm-Inspired Theme and Design System

The UI theme is part of the product scope and must not be treated as a late cosmetic task. A user familiar with MobaXterm should be able to understand the main screen immediately without relearning where sessions, Quick Connect, tabs, terminals, SFTP, and MultiExec are located.

#### 6.2.1 Design Goal

The default desktop theme should reproduce the **visual hierarchy and workflow density** of MobaXterm while being implemented entirely with original web code and original/open-source assets.

The target feeling is:

- Desktop engineering utility rather than a SaaS dashboard
- Compact controls and high information density
- Persistent session navigation on the left
- Terminal as the dominant content area
- Clearly visible tab strip
- Fast access to Quick Connect
- Familiar toolbar/menu placement
- Dark terminal canvas even when the surrounding application chrome is light
- Optional dark application chrome
- Small, functional status indicators rather than large decorative cards

The implementation should favor utility, responsiveness, and keyboard-driven operation over animation-heavy or mobile-first visual patterns.

#### 6.2.2 Default Desktop Composition

The default layout should follow this visual structure:

```text
+-----------------------------------------------------------------------------------+
| App Menu: Terminal  Sessions  View  Tools  Settings  Macros  Help                |
+-----------------------------------------------------------------------------------+
| Toolbar / Quick Connect: [ user@host:22________________ ] [Connect] [+ Session]   |
+--------------------------+--------------------------------------------------------+
| Sessions / SSH Browser   | [DUT1] [DUT2] [Graylog] [NAS] [+]                    |
|                          +--------------------------------------------------------+
| > User sessions          |                                                        |
|   > ERP Lab              |                  TERMINAL WORKSPACE                    |
|      DUT1                |                                                        |
|      DUT2                |        dark xterm.js terminal canvas                  |
|      DUT3                |                                                        |
|      DUT4                |                                                        |
|                          |                                                        |
| > Servers               |                                                        |
|      Graylog             |                                                        |
|      NAS                 |                                                        |
+--------------------------+--------------------------------------------------------+
| Status / MultiExec / connection state / transfer state                           |
+-----------------------------------------------------------------------------------+
```

When an SSH session has SFTP support, the left panel should be able to switch between **Sessions** and **SSH Browser** without forcing a new top-level page. This mirrors the efficient MobaXterm pattern where navigation and remote files remain adjacent to the terminal.

#### 6.2.3 Required UI Regions

The following regions are required in the desktop compatibility theme:

1. **Application menu row**
   - Terminal
   - Sessions
   - View
   - Tools
   - Settings
   - Macros
   - Help
   - Items that are not yet implemented may be hidden rather than shown as dead controls.

2. **Compact toolbar / Quick Connect row**
   - Quick Connect text field
   - New session action
   - Split-view controls when applicable
   - MultiExec toggle when multiple terminals are open
   - Search / command palette entry may be added without disturbing the familiar layout.

3. **Left sidebar**
   - Saved session tree
   - Expandable folders/groups
   - Protocol/session icons
   - Favorites/recent sessions when enabled
   - Collapsible/resizable width
   - Ability to switch to the active session's SFTP browser

4. **Terminal tab strip**
   - Compact tabs
   - Active/inactive state with strong contrast
   - Close button
   - Connection-state icon
   - Reorder by drag and drop
   - Context menu for duplicate, reconnect, close, move to split, and session information

5. **Terminal workspace**
   - Dark terminal background by default
   - Thin separators between split panes
   - Minimal padding to maximize usable rows/columns
   - Focused pane must have a subtle but obvious border or header state

6. **Bottom/status area**
   - Connection state
   - MultiExec state and selected target count
   - Transfer state when SFTP operations exist
   - Optional latency/keepalive indicators

#### 6.2.4 Theme Modes

The application should ship with at least these UI modes:

**MobaXterm Classic Light - default**

- Light application chrome
- White/light-gray sidebar
- Compact gray separators
- Dark active terminal/tab treatment
- Dark terminal canvas
- Colored connection/session icons

**MobaXterm Classic Dark**

- Dark application chrome and sidebar
- Dark tab strip
- Dark terminal canvas
- High-contrast text and status icons

**Custom** - Phase 4+

- User-defined terminal palette
- Font family and size
- Cursor style
- Background/foreground colors
- Per-profile theme override
- UI density preference

The terminal palette and the application chrome theme must be independent. For example, a user may choose light application chrome with a Solarized Dark terminal.

#### 6.2.5 Initial Design Tokens

Exact values may be tuned during visual implementation, but the project should centralize all theme values as tokens rather than spreading literal values through components.

```css
:root[data-theme="mobaxterm-classic-light"] {
  --app-bg: #efefef;
  --panel-bg: #ffffff;
  --toolbar-bg: #f4f4f4;
  --border: #c7c7c7;
  --text-primary: #202020;
  --text-secondary: #666666;
  --tab-bg: #dddddd;
  --tab-active-bg: #252525;
  --tab-active-fg: #f4f4f4;
  --terminal-bg: #080808;
  --terminal-fg: #e8e8e8;
  --accent: #169c84;
  --warning: #c47a00;
  --danger: #c43d3d;
  --success: #2d9d55;
}
```

These are project-owned approximation tokens and are not asserted to be the exact proprietary colors used by MobaXterm.

#### 6.2.6 Typography

UI font:

```text
system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Terminal font defaults should prioritize fonts commonly available on macOS and Windows:

```text
Menlo, Monaco, "Cascadia Mono", Consolas, monospace
```

Optional bundled/open-source terminal fonts may be added later, but the project must not redistribute a proprietary MobaXterm font unless its license explicitly permits it.

#### 6.2.7 Iconography

The project should reproduce the **semantic role** of MobaXterm icons, not copy its icon files.

Recommended approach:

- Use Lucide, Material Symbols, or original SVG artwork.
- Use distinct icons for SSH, SFTP, RDP, VNC, Telnet, Serial, folders, favorites, and workspaces.
- Allow a custom icon per saved session.
- Preserve compact icon sizing suitable for a dense session tree.
- Use color carefully to distinguish protocols and state without relying on color alone.

The MobaXterm logo, Mobatek logo, proprietary icons, screenshots, or extracted executable resources must not be shipped as application assets.

#### 6.2.8 Tab and Split-View Behavior

The tab strip should intentionally feel like a desktop terminal application rather than browser tabs or large web-app navigation pills.

Requirements:

- Compact height
- Dense labels
- Strong active-tab contrast
- Connection-state glyph
- Middle-click to close where the browser allows it
- Right-click context menu
- Keyboard tab cycling
- Duplicate/reconnect actions
- Split into 2 or 4 panes
- Move a session from one pane to another
- Optional detachable/pop-out session in a later phase

A four-pane split should preserve as much terminal area as possible and avoid oversized headers.

#### 6.2.9 MultiExec Visual Language

MultiExec must have a visual state that is impossible to miss.

When MultiExec is OFF:

- Normal terminal borders
- No broadcast target badges

When MultiExec is ON:

- Persistent highlighted MultiExec control
- Selected panes visibly marked
- Unselected panes visibly excluded
- Selected target count always visible
- Paste action uses confirmation for multi-line or multi-target content
- A single-pane temporary focus mode is available without losing the saved selection

The exact colors may differ from MobaXterm, but the behavior must retain the same immediate awareness that input is being broadcast.

#### 6.2.10 SFTP / SSH-Browser Visual Integration

When SFTP is available for the active SSH session:

- The left sidebar can switch from the saved session tree to the SSH browser.
- Directory path is visible at the top of the sidebar.
- Files use a compact details/tree presentation.
- Drag-and-drop upload is supported in Phase 3.
- Context actions include download, upload, rename, delete, new directory, refresh, and edit where authorized.
- Switching terminal tabs updates the SSH-browser context to the active session.
- A user can pin the SFTP view if they do not want automatic context switching.

#### 6.2.11 Responsive Behavior

The MobaXterm compatibility theme is desktop-first.

For a MacBook-sized viewport:

- Sidebar default width: approximately 240-300 px
- Sidebar can collapse to an icon rail or disappear
- Terminal is always prioritized over decorative controls
- Toolbars may move lower-priority actions into an overflow menu

For tablets:

- Sidebar becomes a drawer
- One or two terminal panes are preferred
- MultiExec remains available but must retain explicit target selection

For phones:

- Basic emergency SSH access is acceptable
- The phone layout is not required to reproduce the full desktop MobaXterm arrangement

#### 6.2.12 Theme Persistence

Persist these preferences per user:

- Application theme: Classic Light / Classic Dark / Custom
- Sidebar width and visibility
- Menu/toolbar visibility
- UI density
- Terminal font and size
- Default terminal palette
- Tab behavior
- SFTP/sidebar mode

Per-profile overrides may define terminal palette, font, cursor, and initial terminal options without changing the global application chrome.

#### 6.2.13 Visual Acceptance Criteria

The compatibility theme is considered complete for the initial release only when all of the following are true:

- The first screen presents a clearly recognizable MobaXterm-style information hierarchy: top controls, left session tree, compact terminal tabs, and terminal-dominant content.
- Classic Light and Classic Dark application themes are both functional.
- The UI remains usable at common MacBook resolutions without horizontal page scrolling.
- Sidebar width, visibility, and active mode persist across reloads.
- Active/inactive tabs are immediately distinguishable.
- MultiExec broadcast state is visually obvious in every split layout.
- SFTP can occupy the left-side browser area without replacing the terminal workspace.
- No proprietary MobaXterm logo, icon file, screenshot crop, or copied executable asset is required to achieve the design.
- Visual regression tests cover the main shell, session sidebar, single-terminal state, four-pane split, MultiExec ON state, SFTP sidebar, Classic Light, and Classic Dark.

#### 6.2.14 Design Reference Policy

Official MobaXterm screenshots and the installed application may be used as **design references during development**. They should not be committed into the product repository as redistributed UI assets unless their use is explicitly permitted and properly attributed.

The implementation should compare against reference screens for:

- Overall density
- Sidebar-to-terminal proportions
- Toolbar height
- Tab density
- Terminal prominence
- SFTP integration
- MultiExec visibility
- Light/dark chrome behavior

The goal is **high workflow and theme fidelity with original implementation assets**.

### 6.3 Workspace Concepts

A **Connection Profile** describes how to connect to one remote target.

A **Session** is a live connection created from a profile or Quick Connect.

A **Pane** renders one live terminal.

A **Workspace** stores a collection of profiles plus layout information.

A **Group** organizes profiles, for example:

```text
ERP Lab
  DUT1
  DUT2
  DUT3
  DUT4
  DUT5
  DUT6
  DUT7
  DUT8

Servers
  Graylog
  GitLab
  NAS
```

A workspace can be started with one action so that all required sessions open and the split layout is restored automatically.

---

## 7. Core Architecture

```text
                               Private LAN / VPN

+-----------------------+          HTTPS / WSS
| Browser               | <------------------------------+
|                       |                                 |
| React + TypeScript    |                                 v
| xterm.js              |                      +-----------------------+
| Workspace UI          |                      | Reverse Proxy         |
+-----------------------+                      | Caddy / Nginx         |
                                               +-----------+-----------+
                                                           |
                                               +-----------v-----------+
                                               | Application Backend   |
                                               |                       |
                                               | Node.js + TypeScript  |
                                               | Fastify               |
                                               | Socket.IO / WebSocket |
                                               | ssh2                  |
                                               +-----+-----------+-----+
                                                     |           |
                                              SSH/SFTP|           | SQL
                                                     |           |
                                  +------------------+      +----v--------+
                                  |                         | PostgreSQL  |
                     +------------v-----------+             | or SQLite   |
                     | Remote systems         |             +-------------+
                     |                        |
                     | Switch / Router / DUT  |
                     | Linux Server           |
                     | NAS                    |
                     +------------------------+
```

### 7.1 Frontend

Recommended stack:

- React
- TypeScript
- Vite
- xterm.js
- xterm fit addon
- xterm search addon
- xterm web-links addon
- Optional xterm WebGL renderer
- Zustand or Redux Toolkit for application state
- React Router
- CSS Grid for terminal layouts

Frontend responsibilities:

- Render terminals
- Manage tabs and split panes
- Display connection state
- Capture keyboard input
- Manage MultiExec target selection
- Render host-key prompts
- Render authentication prompts
- Display SFTP/file browser
- Manage layout state
- Save client preferences
- Reconnect to existing backend sessions

The frontend must never receive a reusable server-side master encryption key.

### 7.2 Backend

Recommended initial stack:

- Node.js LTS
- TypeScript
- Fastify
- Socket.IO or native WebSocket
- `ssh2`
- PostgreSQL for production
- SQLite allowed for early single-user development
- Pino or equivalent structured logging

Backend responsibilities:

- Authenticate web users
- Authorize connection targets
- Establish SSH connections
- Maintain SSH connection state
- Create interactive PTY shell channels
- Resize PTYs
- Stream terminal data
- Perform host-key verification
- Handle SSH keys and passwords securely
- Create SFTP sessions
- Perform file transfer streaming
- Manage connection profiles
- Persist workspace layouts
- Manage jump hosts
- Manage SSH forwarding
- Maintain reconnectable live sessions
- Audit security-relevant events

### 7.3 Reverse Proxy

A reverse proxy should terminate TLS and forward REST/WebSocket traffic to the backend.

Recommended options:

- Caddy for simple internal TLS
- Nginx for conventional deployments
- Traefik when integrated into a larger Docker environment

HTTPS should be used even inside a LAN because terminal credentials and session content are security-sensitive.

---

## 8. SSH Session Lifecycle

```text
User selects profile
        |
        v
Frontend requests session
        |
        v
Backend validates authorization and target policy
        |
        v
Resolve credential reference
        |
        v
Open TCP connection from backend to target
        |
        v
SSH handshake
        |
        v
Verify server host key
        |
        v
Authenticate user
        |
        v
Allocate PTY
        |
        v
Open interactive shell
        |
        v
Create application session ID
        |
        v
Stream terminal data over authenticated WebSocket
```

### Session States

```text
CREATED
CONNECTING
HOST_KEY_PENDING
AUTHENTICATING
OPEN
DETACHED
RECONNECTING
CLOSING
CLOSED
FAILED
```

The UI should expose these states clearly rather than reducing every failure to a generic "Disconnected" message.

---

## 9. Browser Reconnect and Session Persistence

There are two different persistence requirements.

### 9.1 Browser Re-Attachment

The backend keeps the SSH connection alive for a configurable grace period after the browser disconnects.

Example:

```text
MacBook loses Wi-Fi
      |
WebSocket disconnects
      |
Backend keeps SSH shell alive
      |
Browser reconnects
      |
User/session token is revalidated
      |
Browser re-attaches to live SSH session
```

This is especially important for switches and appliances that do not provide `tmux`.

The backend should maintain a bounded terminal replay buffer so the browser can redraw recent output after re-attachment.

### 9.2 True Shell Persistence

For Linux targets where `tmux` is available, the project may optionally launch or attach to a managed tmux session.

This provides persistence even if the application backend restarts.

`tmux` must remain optional because many network devices do not support it.

---

## 10. Multi-Session Workspace

### Required Capabilities

- Open several live sessions concurrently
- Drag tabs to reorder
- Move a session into another pane
- 1-pane layout
- 2-pane horizontal layout
- 2-pane vertical layout
- 4-pane grid
- Custom grid layout later
- Full-screen one pane temporarily
- Restore previous layout
- Save layout as workspace

### Recommended Initial Limits

These are engineering targets, not guaranteed product limits:

- 8 simultaneous visible panes should feel smooth on a modern laptop
- 16 visible panes should remain usable for monitoring
- 32 concurrent SSH sessions per application instance should be a minimum validation target
- Additional background tabs should consume limited browser rendering resources

---

## 11. MultiExec / Broadcast Input

MultiExec is one of the project's defining capabilities.

### Behavior

```text
Keyboard / paste input
        |
        v
MultiExec controller
        |
        +--------> Session A
        +--------> Session B
        +--------> Session D
```

Only explicitly selected sessions receive broadcast input.

### UX Requirements

- MultiExec must be OFF by default.
- Enabling MultiExec must create a strong visible UI state.
- Each pane must indicate whether it is included or excluded.
- "Select all" and "Select none" controls are required.
- Closing or disconnecting a pane automatically removes it from the selection.
- The active target count must always be visible.
- The user must be able to temporarily focus input on only one pane without destroying the group selection.

### Paste Safety

Pasting is more dangerous than normal typing because a clipboard may contain multiple commands.

When MultiExec is enabled, the application should show a confirmation dialog for:

- Multi-line paste
- Large paste payloads
- Paste into more than one target

Optional later safety checks may flag suspicious Unicode or control characters.

### Sensitive Input

Password prompts inside an interactive remote shell cannot always be detected reliably. The application therefore must not assume that it can safely determine when a user is entering a secret.

Recommended safeguards:

- Do not log user keystrokes by default.
- Provide a one-click "Sensitive Input" mode that temporarily disables input logging and MultiExec.
- Always disable MultiExec for explicit application-level authentication dialogs.

---

## 12. Connection Profiles

A connection profile should support:

```yaml
name: DUT1
protocol: ssh
host: 192.168.10.11
port: 22
username: admin
credentialRef: lab-admin-key
folder: ERP-Lab
terminal:
  type: xterm-256color
  columns: 120
  rows: 40
  keepaliveSeconds: 30
jumpHost: null
hostKeyPolicy: strict
```

Optional profile settings:

- Terminal type
- Keepalive interval
- Initial command
- Working directory for Linux targets
- Encoding
- Environment variables where supported
- Jump host
- Proxy settings
- Per-profile theme
- SFTP default directory
- Reconnect policy
- Tags

---

## 13. Quick Connect

The UI should support a command-style entry such as:

```text
ssh admin@192.168.10.11
```

or:

```text
admin@192.168.10.11:2222
```

Quick Connect can create an ephemeral session without saving a profile.

The user should be able to convert an ephemeral session into a saved connection later.

---

## 14. Authentication Methods

### Phase 1

- Username + password
- OpenSSH private key
- Encrypted private key + passphrase

### Later

- Keyboard-interactive SSH authentication
- SSH agent
- Agent forwarding
- Certificate-based SSH authentication
- Team secret integrations

Credential handling should distinguish between:

1. Session-only credentials
2. Saved encrypted credentials
3. External secret references

Session-only credentials should be the safest default for passwords.

---

## 15. Host-Key Verification

Host-key verification is mandatory for a security-conscious implementation.

Supported policy modes:

### Strict

Only connect when the target key matches an existing trusted key.

### Trust On First Use (TOFU)

For an unknown host:

1. Show hostname/IP
2. Show port
3. Show algorithm
4. Show SHA-256 fingerprint
5. Require explicit accept or reject
6. Optionally persist the trusted key

For a key mismatch:

- Block the connection
- Display expected fingerprint
- Display received fingerprint
- Require the old trust entry to be explicitly removed or updated

The application must not silently overwrite a changed host key.

---

## 16. SFTP File Browser

The SFTP experience should be linked to the currently active SSH session.

### Core Operations

- List directory
- Navigate directories
- Upload file
- Download file
- Create directory
- Rename
- Delete
- View metadata
- Refresh

### Phase 3 Enhancements

- Drag-and-drop upload
- Multiple file transfer
- Transfer progress
- Cancel transfer
- Conflict confirmation
- Remote text preview
- Remote text editor
- Download selected files as archive where appropriate

### Transfer Architecture

Large file transfers should use streaming HTTP endpoints or dedicated binary streams rather than encoding complete files into JSON/WebSocket messages.

Controls should include:

- Maximum upload size
- Maximum concurrent transfers
- Path validation
- Per-user authorization
- Transfer timeout
- Backpressure
- Explicit overwrite confirmation

---

## 17. Remote Text Editor

A lightweight remote editor can provide a MobaXterm-like workflow for configuration files.

Recommended behavior:

1. User selects a remote text file.
2. Backend reads file through SFTP.
3. Frontend loads it into Monaco Editor or CodeMirror.
4. User edits the file.
5. Save performs an SFTP upload to a temporary remote file.
6. Backend performs a safe replacement where possible.

Requirements:

- File size limit
- Binary-file rejection
- Explicit encoding handling
- Concurrent edit warning where practical
- Backup option before overwrite

This feature is not intended to replace a complete IDE.

---

## 18. Terminal Productivity Features

### Search

Use the xterm.js search addon to search visible scrollback.

### Scrollback

Configurable per user or profile.

### Copy/Paste

Support standard browser clipboard operations and keyboard shortcuts.

### Clickable Links

Detect URLs and expose them safely to the browser.

### Command Snippets

Example:

```yaml
name: Show interfaces
command: show interfaces status
category: Switching
```

Snippets may be sent to:

- Active session
- Selected MultiExec sessions
- Saved workspace group

The application must preview a snippet before broadcasting it to multiple sessions if the snippet contains multiple lines.

### Macros

A macro is an ordered sequence of user actions or commands.

Phase 4 should initially implement command-oriented macros, not arbitrary secret-bearing keystroke recording.

---

## 19. Session Logging

Logging modes:

- Disabled
- Output only
- Output + timestamps
- Full transcript where explicitly enabled

Input logging should be disabled by default because terminal input may contain passwords, tokens, or other secrets.

Log metadata may include:

- User
- Profile ID
- Host
- Start time
- End time
- Exit/disconnect reason
- Source IP of browser

Session logs should have retention controls.

---

## 20. SSH Jump Hosts and Gateways

Phase 5 should support chains such as:

```text
Browser
   |
Backend
   |
SSH -> Bastion
          |
          +-> SSH -> Target
```

A connection profile can reference another profile as a jump host.

Requirements:

- Prevent circular jump-host references
- Distinguish gateway credentials from target credentials
- Verify host keys at each hop
- Expose connection errors by hop
- Apply target authorization policy after resolving the chain

---

## 21. SSH Port Forwarding

### Local-Style Forward

Expose a port on the application host or a tightly controlled proxy endpoint and forward it through SSH to a destination.

### Remote Forward

Request a remote SSH server listener that forwards back through the SSH connection.

### Dynamic SOCKS

Create a SOCKS proxy using the SSH transport.

### Security Requirements

Port forwarding can turn the application into a generic network pivot. It must therefore be subject to explicit policy:

- Disabled by default in multi-user environments
- Allowed bind addresses
- Allowed destination CIDRs
- Allowed destination ports
- Per-user permissions
- Audit events
- Idle timeout
- Tunnel count limits

---

## 22. Security Architecture

### 22.1 Threat Model

The backend is security-sensitive because it can:

- Reach internal network targets
- Hold SSH credentials
- Transfer files
- Create tunnels
- Execute terminal input chosen by a user

Threats include:

- Stolen web session
- Malicious browser script
- CSRF
- WebSocket hijacking
- Credential theft
- SSRF / unauthorized network pivot
- Malicious or compromised SSH host
- Host-key spoofing
- Accidental MultiExec command broadcast
- Path traversal in file APIs
- Unauthorized session attachment
- Sensitive data leakage through logs

### 22.2 Web Authentication

Initial options:

- Local user/password account for development
- Reverse-proxy authentication for trusted deployments

Later options:

- OIDC
- LDAP/Active Directory
- WebAuthn / passkeys
- TOTP MFA

### 22.3 Browser Session Security

- Secure, HttpOnly session cookies
- SameSite policy
- Short-lived session tokens
- CSRF protection for state-changing REST APIs
- Strict WebSocket origin validation
- Authorization check for every session attach operation

### 22.4 Target Network Policy

Never allow an authenticated browser user to connect to arbitrary destinations solely because the backend can reach them.

Support:

- Allowed CIDRs
- Denied CIDRs
- Allowed ports
- DNS suffix allowlist
- Per-user or per-role host policy
- Connection-rate limits

Special care must be taken around loopback, Docker networks, cloud metadata endpoints, management networks, and internal application infrastructure.

### 22.5 Credential Storage

Preferred model:

```text
Database
  encrypted credential blob
        |
        v
AES-256-GCM or equivalent authenticated encryption
        |
        v
Master key from deployment secret
```

Rules:

- Master key is never stored in the application database.
- Private keys are encrypted at rest.
- Password storage is optional and disabled by default where possible.
- Passphrases may remain session-only.
- Secrets must never appear in normal logs.
- Decrypted secrets should exist in process memory only as long as required.

Future deployments may integrate a dedicated secrets manager.

### 22.6 Host-Key Security

- Store trusted host keys separately from credentials.
- Record first-seen and last-seen timestamps.
- Never silently replace a mismatched key.
- Audit trust changes.

### 22.7 Content Security

Recommended headers:

- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- Frame restrictions / frame-ancestors
- HSTS when HTTPS is correctly deployed

---

## 23. Data Model

Suggested initial entities:

### users

```text
id
username
password_hash / external_identity
role
created_at
updated_at
```

### connection_profiles

```text
id
owner_id
name
protocol
host
port
username
credential_id
folder_id
jump_profile_id
host_key_policy
terminal_options_json
created_at
updated_at
```

### credentials

```text
id
owner_id
name
type
encrypted_payload
created_at
updated_at
```

### trusted_host_keys

```text
id
owner_id
host
port
algorithm
fingerprint
public_key
first_seen_at
last_verified_at
```

### folders

```text
id
owner_id
parent_id
name
sort_order
```

### workspaces

```text
id
owner_id
name
layout_json
created_at
updated_at
```

### snippets

```text
id
owner_id
name
category
command_text
created_at
updated_at
```

### audit_events

```text
id
user_id
event_type
target
metadata_json
created_at
```

Live SSH session state should not initially be persisted as if it were a normal database record. The live socket/channel belongs to a backend session manager.

---

## 24. REST API Sketch

Example API surface:

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/me

GET    /api/connections
POST   /api/connections
GET    /api/connections/:id
PUT    /api/connections/:id
DELETE /api/connections/:id

GET    /api/folders
POST   /api/folders

GET    /api/workspaces
POST   /api/workspaces
PUT    /api/workspaces/:id

POST   /api/sessions
GET    /api/sessions
DELETE /api/sessions/:id

GET    /api/sessions/:id/files
POST   /api/sessions/:id/files/upload
GET    /api/sessions/:id/files/download

GET    /api/snippets
POST   /api/snippets

GET    /api/audit
```

The exact API is expected to evolve during implementation.

---

## 25. WebSocket Protocol Sketch

### Client to Server

```text
session:attach
session:detach
terminal:input
terminal:resize
terminal:signal
session:keepalive
hostkey:accept
hostkey:reject
auth:response
```

### Server to Client

```text
session:state
terminal:data
terminal:title
hostkey:request
auth:request
session:replay
session:error
session:closed
```

### MultiExec

MultiExec may remain a frontend concept: the frontend sends the same `terminal:input` payload to several authorized session IDs.

Alternatively, a backend batch endpoint can be introduced later for stronger synchronization.

For the first implementation, frontend fan-out is simpler and keeps each live session isolated.

---

## 26. Error Model

The frontend should provide meaningful categories such as:

```text
DNS_RESOLUTION_FAILED
TARGET_NOT_ALLOWED
TCP_CONNECTION_REFUSED
TCP_TIMEOUT
SSH_HANDSHAKE_FAILED
HOST_KEY_UNKNOWN
HOST_KEY_MISMATCH
AUTH_FAILED
AUTH_METHOD_UNSUPPORTED
PTY_ALLOCATION_FAILED
CHANNEL_OPEN_FAILED
SESSION_EXPIRED
SESSION_NOT_OWNED
SFTP_UNAVAILABLE
SFTP_PERMISSION_DENIED
TRANSFER_LIMIT_EXCEEDED
JUMP_HOST_FAILED
```

The UI should show a user-friendly message while retaining structured diagnostic detail for logs.

---

## 27. Deployment

### Initial Docker Deployment

```text
+---------------------+
| reverse-proxy       |
| 443 -> app          |
+----------+----------+
           |
+----------v----------+
| web-ssh-workspace   |
| frontend + backend  |
+----------+----------+
           |
+----------v----------+
| postgres            |
+---------------------+
```

Development may use SQLite and a single application container.

Production should separate persistent data from the application container.

### Example Repository Structure

```text
web-ssh-workspace/
  apps/
    web/
      src/
        components/
        terminal/
        workspace/
        files/
        settings/
        stores/
    server/
      src/
        auth/
        api/
        ssh/
        sftp/
        websocket/
        sessions/
        security/
        db/
  packages/
    shared/
      src/
        protocol/
        types/
  deploy/
    docker/
    nginx/
  tests/
    integration/
    e2e/
  docs/
  docker-compose.yml
  README.md
```

---

## 28. Observability

Metrics should include:

- Active web users
- Active SSH connections
- Detached SSH connections
- Connection attempts
- Authentication failures
- Host-key mismatches
- SSH handshake duration
- WebSocket reconnect count
- SFTP transfer bytes
- Transfer failures
- MultiExec activation count
- Backend event-loop lag
- Process memory

Do not place passwords, private key contents, tokens, or terminal content in normal application metrics.

---

## 29. Testing Strategy

### Unit Tests

- Connection profile validation
- Target policy validation
- Host-key verification logic
- Credential encryption/decryption
- Workspace layout reducer
- MultiExec selection state
- Path validation

### SSH Integration Tests

Use disposable OpenSSH containers to test:

- Password authentication
- Public-key authentication
- Encrypted keys
- Wrong password
- Unknown host key
- Changed host key
- PTY resize
- SFTP
- Jump host
- Port forwarding
- Disconnect/reconnect

### Frontend E2E Tests

Use Playwright to validate:

- Open profile
- Open multiple tabs
- Split terminal
- MultiExec selection
- Broadcast typing
- Reconnect browser
- Upload/download
- Host-key acceptance

### Visual Regression Tests

Use Playwright screenshot tests for:

- MobaXterm-inspired Classic Light main shell
- Classic Dark main shell
- Expanded and collapsed session sidebar
- Active/inactive terminal tabs
- 2-pane and 4-pane split layouts
- MultiExec OFF / ON / partial-selection states
- SFTP / SSH Browser sidebar
- Host-key and paste-confirmation dialogs
- Common MacBook viewport sizes

Visual tests should validate project-owned implementation screenshots. Official MobaXterm screenshots are design references, not golden assets committed into the application bundle.

### Security Tests

- Authorization bypass attempts
- WebSocket session hijacking
- CSRF
- SSRF to blocked targets
- Path traversal
- Oversized upload
- Brute-force login rate limiting
- Cross-user session attachment

---

## 30. Proposed Performance Targets

These are project targets to benchmark, not promises:

- Additional terminal streaming latency introduced by the gateway: p95 below 30 ms on a LAN under normal load
- Re-attach to a surviving backend session within 5 seconds after browser connectivity returns
- Smooth operation with at least 8 simultaneously visible active terminals
- Usable monitoring layout with 16 visible panes
- At least 32 concurrent SSH connections during baseline load testing
- Large terminal output must use backpressure and bounded buffers instead of unbounded memory growth
- SFTP transfers should stream rather than load entire files into memory

---

# 31. Implementation Roadmap

## Phase 0 - Foundation and Security Baseline

### Goal

Create the project skeleton and make the architectural decisions that are difficult to change later.

### Scope

- Monorepo or clear frontend/backend repository structure
- React + TypeScript frontend
- Node.js + TypeScript backend
- Fastify
- xterm.js proof of concept
- WebSocket transport
- `ssh2` proof of concept
- Database migrations
- Docker development environment
- TLS-capable reverse-proxy configuration
- Structured logging
- Configuration system
- Initial target allowlist / CIDR policy
- Initial threat model
- MobaXterm-inspired UI shell and design-token system
- Classic Light and Classic Dark theme foundations
- Original/open-source icon set selection
- Visual-reference checklist for sidebar, toolbar, tabs, terminal, and status area

### Deliverables

- Browser terminal can communicate with backend through WSS
- Backend can open a test SSH connection to an allowed development target
- Repository includes development and Docker instructions
- Security assumptions documented
- Static application shell demonstrates the MobaXterm-inspired top menu/toolbar, Quick Connect area, left session tree, compact tab strip, terminal workspace, and status area
- Theme tokens support Classic Light and Classic Dark without component-specific hard-coded colors

### Acceptance Criteria

- No direct SSH credential is stored in browser localStorage
- Backend refuses a target outside configured allowed networks
- Terminal I/O is functional through WebSocket
- CI runs lint, type checking, and unit tests
- Visual smoke tests capture the default desktop shell in Classic Light and Classic Dark

---

## Phase 1 - Core SSH MVP

### Goal

Deliver a reliable single-session browser SSH client with saved profiles.

### Features

- Quick Connect
- Saved connection profiles
- Hostname/IP and custom SSH port
- Username/password authentication
- OpenSSH private-key authentication
- Encrypted private-key passphrase prompt
- Interactive xterm.js terminal
- PTY resize
- Terminal copy/paste
- Configurable scrollback
- Keepalive
- Disconnect
- Basic reconnect
- Host-key verification
- TOFU acceptance UI
- Hard block on host-key mismatch
- Basic encrypted credential storage
- Responsive desktop UI
- MobaXterm-inspired Classic Light theme as the default application appearance
- Classic Dark application theme
- Compact top menu/toolbar and Quick Connect placement
- Left saved-session tree matching the desktop terminal workflow
- Compact single-session tab/header treatment
- Persisted sidebar width/visibility and UI theme preference

### Acceptance Criteria

- User can save DUT1 and connect from Safari/Chrome/Edge
- User can authenticate using password or key
- Resizing the browser updates the SSH PTY size
- Unknown host keys require explicit user action
- Changed host keys are blocked
- Closing a session releases its SSH resources
- Normal logs contain no password/private-key content
- A MobaXterm user can identify Quick Connect, saved sessions, the active terminal, and core connection actions without onboarding documentation
- Classic Light and Classic Dark render correctly in supported desktop browsers

---

## Phase 2 - Multi-Session Workspace and MultiExec

### Goal

Reach the first version that provides the workflow advantage over a basic WebSSH client.

### Features

- Multiple SSH tabs
- MobaXterm-style compact tab strip and tab context menu
- 1/2/4-pane layouts
- Drag/reorder tabs
- Move terminal between panes
- Session folders/groups
- Batch-open a group
- Save workspace layout
- Restore workspace layout
- Selective MultiExec
- Select all / select none
- Clear MultiExec visual state
- Selected/unselected pane styling consistent with the compatibility theme
- Multi-line paste confirmation
- Per-terminal online/offline/reconnecting indicator
- Terminal search
- Browser disconnect grace period
- Re-attach to surviving backend SSH session
- Bounded terminal replay buffer

### Acceptance Criteria

- User can open at least 8 lab DUTs concurrently
- User can place four DUTs in a 2 x 2 view
- User can broadcast a command to only selected DUTs
- A disconnected DUT is automatically removed from MultiExec targeting
- Reloading the browser can re-attach to a backend session still within its grace period
- A MultiExec paste to several terminals requires confirmation
- Visual-regression coverage exists for tabbed, split, and MultiExec states in both Classic Light and Classic Dark

### Milestone

At the end of Phase 2, the project should already be useful as a daily SSH workspace for network lab work.

---

## Phase 3 - SFTP and Remote File Workflow

### Goal

Add the file-management workflow normally paired with SSH.

### Features

- SFTP sidebar for active session
- MobaXterm-style Sessions / SSH Browser switching in the left sidebar
- Directory navigation
- Upload
- Download
- Rename
- Delete
- Create directory
- Drag-and-drop upload
- Transfer queue
- Progress display
- Cancellation
- Conflict handling
- File metadata
- Text preview
- Lightweight remote editor
- Safe save/replace flow

### Acceptance Criteria

- File browser opens using the existing SSH connection or associated SSH transport
- Large files are streamed without loading the full file into backend memory
- Transfer cancellation works
- Unauthorized paths/actions are rejected
- Browser shows clear SFTP error messages
- Changing the active terminal updates the SSH-browser context unless the file browser is pinned

---

## Phase 4 - Productivity and Session Management

### Goal

Make the workspace efficient for repeated daily engineering workflows.

### Features

- Command snippets
- Snippet categories
- Send snippet to active terminal
- Send snippet to selected MultiExec sessions
- Command-oriented macros
- Session output logging
- Log download/viewer
- Saved terminal themes
- Custom application theme overrides built on the centralized token system
- UI density setting
- Optional toolbar/menu visibility preferences
- Custom per-session icon using original/user-provided artwork
- Per-profile terminal options
- Tags
- Favorites
- Recently used sessions
- Duplicate profile
- Import/export profile configuration
- CSV session import
- Workspace templates
- Clone/duplicate workspace
- Keyboard shortcuts
- Search connections by name, host, group, or tag

### Acceptance Criteria

- User can open a saved lab workspace with one action
- User can execute a reusable read-only diagnostic snippet across selected DUTs
- User can export connection metadata without exporting secret material by default
- Terminal output logging can be enabled per session/profile

---

## Phase 5 - Advanced SSH and Network Access

### Goal

Support complex engineering environments with bastions and tunnels.

### Features

- Jump host / bastion
- Multiple-hop design where practical
- Separate gateway and target credentials
- Keyboard-interactive authentication
- SSH agent integration where deployment allows it
- Agent forwarding as an explicit opt-in
- Local-style port forwarding
- Remote port forwarding
- Dynamic SOCKS forwarding
- Tunnel manager
- Tunnel status dashboard
- Connection timeout configuration
- SSH algorithm policy configuration for legacy equipment
- Optional NETCONF subsystem support

### Acceptance Criteria

- User can reach a target that is accessible only through one configured jump host
- Host keys are verified independently for gateway and target
- Tunnel creation is restricted by policy
- Active tunnels are visible and can be terminated explicitly
- A failed gateway is distinguishable from a failed target

---

## Phase 6 - Persistence, Team Features, RBAC, and Operations

### Goal

Evolve from a personal lab tool into a safely shareable internal service.

### Features

- Multiple application users
- Role-based access control
- Per-user connection ownership
- Shared connection groups
- Shared read-only profiles
- Audit event viewer
- Configurable retention
- MFA / OIDC integration
- Credential vault abstraction
- External secret-manager integration option
- Session quotas
- Per-user concurrent connection limits
- Admin target policies
- Health endpoints
- Metrics
- Backup/restore procedures
- Redis or equivalent where required for multi-instance coordination
- Session worker separation if scaling requires it

### Acceptance Criteria

- One user cannot attach to another user's SSH session
- One user cannot read another user's saved secrets
- Admin can restrict a user/role to defined network ranges
- Sensitive operations generate auditable metadata
- Application restart does not corrupt saved profiles/workspaces

---

## Phase 7 - Extended Remote Access Protocols

### Goal

Add selected MobaXterm-like protocols without weakening the SSH-first architecture.

### Telnet

Implement through the backend using the same xterm.js terminal UI.

Use only for legacy trusted equipment because Telnet is unencrypted.

### Serial

Possible implementation options:

1. Serial device physically attached to the application server
2. Small serial gateway service near the equipment
3. Browser Web Serial for local devices where browser support and security policy permit it

Server-side serial gateway is preferred for a consistent cross-device experience.

### RDP and VNC

Integrate Apache Guacamole rather than implementing desktop protocols from scratch.

Desired integration:

```text
Web SSH Workspace
       |
       +-- SSH terminal -> native terminal service
       |
       +-- RDP/VNC ------> Guacamole / guacd
```

### X11

Native MobaXterm X11 behavior cannot be reproduced cleanly by a normal browser because the browser is not an X server.

Possible experimental alternatives:

- Xpra HTML5
- X application inside a remote desktop session
- VNC/Guacamole desktop

X11 is explicitly not a core project requirement.

### Acceptance Criteria

- Telnet sessions can use the same multi-tab workspace with prominent insecure-protocol warning
- RDP/VNC can be opened from the same session manager when Guacamole integration is enabled
- Optional modules can be disabled completely in deployments that do not need them

---

## Phase 8 - Hardening and Production Release

### Goal

Prepare a stable long-lived internal release.

### Work Items

- Full threat-model review
- Dependency security review
- Secure default configuration
- Penetration testing
- Stress testing
- Soak testing with long-running SSH sessions
- Upgrade/migration testing
- Backup restore testing
- Docker image hardening
- Run as non-root
- Read-only container filesystem where practical
- Drop unnecessary Linux capabilities
- Resource limits
- SBOM generation
- Release signing
- Admin documentation
- Troubleshooting guide
- Disaster recovery documentation

### Acceptance Criteria

- Security checklist passes
- Long-running session soak test passes
- Upgrade preserves database and user configuration
- Recovery from backup is documented and verified
- Default Docker deployment does not require privileged mode

---

## 32. Optional Future Features

These features are useful but should not delay the core SSH roadmap.

### Collaboration

- Share read-only terminal
- Shared interactive terminal with explicit consent
- Operator/viewer roles
- Temporary session link

### Automation

- Scheduled command snippets
- Predefined diagnostic workflows
- Collect command output from several devices
- Export results as JSON/text

Automation must not become an unrestricted remote command execution system without a separate security design.

### Connection Discovery

- Network scan for SSH endpoints
- Import from CSV
- Import from OpenSSH config
- Import from supported third-party session formats

Network scanning should be admin-controlled.

### Mobile UX

- Mobile terminal toolbar
- Esc/Ctrl/Alt buttons
- Function-key row
- Touch-friendly tab switching

### Command Palette

Example actions:

```text
> Open ERP Lab
> Split Right
> Enable MultiExec
> Search Terminal
> Upload File
> Start Tunnel
```

---

## 33. Non-Goals

The initial project is not intended to:

- Reproduce the entire Windows environment bundled with MobaXterm
- Run arbitrary Windows applications
- Replace a full IDE
- Expose SSH directly from browser JavaScript to TCP port 22
- Act as an unrestricted network proxy
- Provide public Internet access by default
- Implement RDP or VNC protocols from scratch
- Depend on tmux for network-device session persistence
- Store plaintext SSH passwords or private keys

---

## 34. Recommended MVP Definition

The smallest version worth using daily should include:

1. Secure web login
2. Saved SSH profiles
3. Quick Connect
4. Password and private-key SSH authentication
5. Host-key verification
6. xterm.js terminal
7. Multiple tabs
8. 1/2/4 split layouts
9. Session groups
10. Selective MultiExec
11. Multi-line paste protection
12. Browser reconnect / backend session re-attach
13. Terminal search
14. Docker deployment

SFTP should follow immediately after this MVP if the project is intended to replace a meaningful portion of MobaXterm usage.

---

## 35. Suggested Technology Decision

### Recommended v1 Stack

```text
Frontend
  React
  TypeScript
  Vite
  xterm.js
  Zustand

Transport
  HTTPS
  WebSocket / Socket.IO

Backend
  Node.js LTS
  TypeScript
  Fastify
  ssh2

Database
  PostgreSQL
  SQLite allowed during prototype stage

Proxy
  Caddy or Nginx

Deployment
  Docker Compose
```

### Why Node.js for v1

The project is primarily event-driven and stream-oriented:

- WebSocket traffic
- SSH streams
- SFTP streams
- Terminal events

The Node.js `ssh2` ecosystem already supports interactive shells, SFTP, connection hopping, forwarding, and other SSH functionality required by the roadmap.

A Go implementation is also valid, particularly if very large concurrency or a single static backend binary becomes a priority, but Node.js/TypeScript offers a fast path to the first usable product while sharing language and types with the frontend.

---

## 36. Key Engineering Risks

### Risk: Credential Exposure

Mitigation:

- Encrypt saved credentials
- Prefer session-only passwords
- Strong web session security
- Avoid terminal input logging

### Risk: Backend Becomes Network Pivot

Mitigation:

- CIDR allowlists
- Port policy
- User authorization
- Forwarding restrictions

### Risk: MultiExec Accident

Mitigation:

- Off by default
- Explicit selected terminals
- Strong visual state
- Paste confirmation
- Sensitive Input mode

### Risk: Browser Disconnect Destroys Session

Mitigation:

- Backend-owned SSH connections
- Detach grace period
- Replay buffer
- Re-attach protocol

### Risk: High Terminal Output Causes Memory Growth

Mitigation:

- Backpressure
- Bounded buffers
- Output throttling where required
- Limit scrollback/replay history

### Risk: Legacy Network Equipment Uses Old SSH Algorithms

Mitigation:

- Configurable per-profile algorithm policy
- Legacy algorithms disabled by default
- Clear security warning when enabled

### Risk: Theme Drifts Away from the Familiar MobaXterm Workflow

**Mitigation:**

- Treat the compatibility theme as a Phase 0/1 requirement rather than polish.
- Centralize layout and theme tokens.
- Maintain visual-regression tests for critical states.
- Review major UI changes against the design-reference checklist.
- Do not trade terminal workspace density for generic dashboard-style cards or excessive whitespace.

### Risk: Too Many Features Delay a Useful Release

Mitigation:

- Keep Phases 0-2 focused on SSH workspace and MultiExec
- Move SFTP to Phase 3
- Move RDP/VNC/Serial to Phase 7
- Treat X11 as experimental

---

## 37. Definition of Success

The project can be considered successful when a user can open a browser on a MacBook, load one saved lab workspace, and comfortably operate several network devices with the same efficiency normally expected from a desktop multi-session SSH client.

A practical success scenario is:

1. Open `ERP Lab`.
2. Eight DUT sessions connect automatically.
3. Four selected DUTs are displayed simultaneously.
4. MultiExec is enabled for DUT1-DUT4.
5. A diagnostic command is broadcast safely.
6. The user disables one target from MultiExec.
7. A file is downloaded through SFTP from one Linux host.
8. Wi-Fi briefly disconnects.
9. Browser connectivity returns.
10. Existing backend sessions are re-attached without requiring all devices to be logged into again.

That workflow represents the central value of Web SSH Workspace.

---

## 38. Reference Projects and Documentation

The project design should study existing implementations and documentation without blindly copying their architecture.

### MobaXterm

- Product: https://mobaxterm.mobatek.net/
- Documentation: https://mobaxterm.mobatek.net/documentation.html
- Release history: https://mobaxterm.mobatek.net/download-home-edition.html
- Official product screenshots/demo: https://mobaxterm.mobatek.net/

Current design-relevant product notes include MobaXterm support for light/dark graphical-interface themes, selectable icon styles, customizable session icons, per-session terminal colors/fonts, a session sidebar, tabbed terminals, split view, MultiExec, and an SSH file browser. These should be treated as reference behaviors rather than assets to copy.

Relevant concepts:

- Session manager
- Multi-tab environment
- 2/4-terminal split views
- Multi-execution mode
- SFTP browser
- SSH gateways and tunnels
- Macros
- Session logs
- Telnet/Serial/RDP/VNC/X11
- Compact desktop application chrome
- Quick Connect placement
- Session tree and sidebar behavior
- Light/dark UI theme behavior
- Dense terminal tabs and split layouts
- SSH-browser integration in the sidebar

### xterm.js

- Documentation: https://xtermjs.org/docs/
- Addons: https://xtermjs.org/docs/guides/using-addons/

Use for browser terminal rendering, terminal events, resizing, search, and optional rendering acceleration.

### ssh2

- Repository/documentation: https://github.com/mscdex/ssh2

Relevant capabilities include:

- Interactive shell
- SFTP
- Public key/password authentication
- Connection hopping
- Port forwarding
- Agent support
- X11 forwarding primitives
- Arbitrary SSH subsystems such as NETCONF

### WebSSH2

- Repository: https://github.com/billchurch/webssh2

Useful as a reference for the standard browser -> WebSocket -> SSH gateway pattern and modern host-key/SFTP behavior.

### Apache Guacamole

- Documentation: https://guacamole.apache.org/doc/gug/

Recommended reference/integration option for:

- RDP
- VNC
- Browser remote desktop
- SSH/SFTP behavior comparison
- Session recording concepts

---

## 39. Proposed Project Tagline

> **Your internal multi-session SSH workspace, available from any browser.**

Alternative:

> **A self-hosted browser workspace for SSH, SFTP, MultiExec, and network lab operations.**

---

## 40. License and Naming Note

The project should use its own product name, logo, and original asset set rather than presenting itself as an official MobaXterm product. MobaXterm is both a workflow and visual-reference target for the compatibility theme.

The project may intentionally recreate the familiar arrangement, density, interaction patterns, light/dark chrome behavior, sidebar model, Quick Connect placement, tabbed-terminal treatment, and MultiExec workflow using original CSS and components. It should **not** ship copied MobaXterm/Mobatek logos, extracted proprietary icons, bundled screenshots, executable resources, or other proprietary artwork as application assets.

If the project is only used internally, the compatibility theme may be described internally as the `MobaXterm-inspired` or `MobaXterm compatibility` theme. A public release should use wording such as `MobaXterm-inspired` and make clear that the project is independent and unaffiliated.

A temporary internal codename such as `Web SSH Workspace`, `WebTermX`, or `LabTerm` can be used until a permanent name is selected.
