import { useEffect, useState, type FormEvent } from "react";
import {
  Terminal,
  Moon,
  Sun,
  PanelLeft,
  LogOut,
  PlugZap,
  Plus,
  Settings,
  KeyRound,
} from "lucide-react";
import {
  parseQuickConnect,
  sessionDtoSchema,
  profileInputSchema,
  type Profile,
  type Preferences,
  type SshSettings,
} from "@workspace/shared";
import { useWorkspace } from "./lib/store";
import { useCatalog } from "./lib/catalog";
import { api, currentUser, login } from "./lib/api";
import {
  attach,
  connectTransport,
  disconnectTransport,
  emit,
} from "./lib/transport";
import { disposeTerminal } from "./lib/terminals";
import { Prompts } from "./components/Prompts";
import {
  CredentialsDialog,
  PreferencesDialog,
  ProfileEditor,
  TrustDialog,
} from "./components/ConfigurationDialogs";
import { WorkspaceCanvas } from "./components/WorkspaceCanvas";
import { SessionSidebar } from "./components/SessionSidebar";
import { WorkspaceDialog } from "./components/WorkspaceDialog";
import { currentOperation } from "./lib/operation";
import { clearAuthentication } from "./lib/authCleanup";
import {
  invalidateAuthentication,
  onAuthenticationInvalidated,
} from "./lib/authLifecycle";
import { ApiRequestError } from "./lib/api";
export default function App() {
  const state = useWorkspace();
  const catalog = useCatalog();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [target, setTarget] = useState("");
  const [dialog, setDialog] = useState<
    "profile" | "preferences" | "credentials" | "trust" | "workspaces" | null
  >(null);
  const [promotingSessionId, setPromotingSessionId] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<Profile | undefined>();
  const [sidebar, setSidebar] = useState(true);
  const [width, setWidth] = useState(260);
  const [busy, setBusy] = useState(false);
  const [sources] = useState(() => new Map<string, SshSettings>());
  async function initialize() {
    const current = currentOperation();
    await useCatalog.getState().refresh();
    if (!current()) return;
    const p = useCatalog.getState().preferences;
    setSidebar(p.sidebarVisible);
    setWidth(p.sidebarWidth);
    connectTransport();
  }
  useEffect(() => {
    const unregister = onAuthenticationInvalidated((error) => {
      const hadUser = !!useWorkspace.getState().user;
      clearAuthentication();
      sources.clear();
      setPassword("");
      setTarget("");
      setEditing(undefined);
      setPromotingSessionId(null);
      setDialog(null);
      setBusy(false);
      setSidebar(true);
      setWidth(260);
      if (error && hadUser) useWorkspace.getState().setError(error.message);
    });
    currentUser()
      .then(async (user) => {
        state.setUser(user);
        await initialize();
      })
      .catch((error) => {
        if (useWorkspace.getState().user) state.setError(String(error));
      })
      .finally(() => setLoading(false));
    return () => {
      unregister();
      disconnectTransport();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);
  function report(error: unknown) {
    state.setError(String(error));
  }
  async function updatePreferences(update: Partial<Preferences>) {
    try {
      await catalog.savePreferences({
        ...useCatalog.getState().preferences,
        ...update,
      });
    } catch (error) {
      report(error);
    }
  }
  function toggleSidebar() {
    const visible = !sidebar;
    setSidebar(visible);
    void updatePreferences({ sidebarVisible: visible });
  }
  function toggleTheme() {
    void updatePreferences({
      theme: state.theme === "classic-light" ? "classic-dark" : "classic-light",
    });
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    const value = password;
    setPassword("");
    try {
      state.setUser(await login(username, value));
      state.setError(null);
      await initialize();
    } catch (error) {
      report(error);
    }
  }
  async function createSession(body: {
    protocol: "ssh";
    profileId?: string;
    settings?: SshSettings;
  }) {
    const current = currentOperation();
    const session = await api(
      "/sessions",
      { method: "POST", body },
      sessionDtoSchema,
    );
    if (!current()) return;
    if (body.settings) sources.set(session.id, body.settings);
    state.upsert(session);
    state.setActive(session.id);
    await attach(session.id);
  }
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await createSession({
        protocol: "ssh",
        settings: parseQuickConnect(target, {
          username: state.user?.username,
          terminal: catalog.preferences.terminal,
        }),
      });
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  function editProfile(profile?: Profile) {
    setPromotingSessionId(null);
    setEditing(profile);
    setDialog("profile");
  }
  async function closeSession(id: string) {
    try {
      await emit("session:close", { sessionId: id });
      disposeTerminal(id);
      sources.delete(id);
      state.removeSession(id);
    } catch (error) {
      report(error);
    }
  }
  if (loading) return <div className="login-screen">Loading workspace…</div>;
  if (!state.user)
    return (
      <div className="login-screen">
        <form className="login-panel" onSubmit={signIn}>
          <h1>
            <Terminal /> Web SSH Workspace
          </h1>
          <p>Your internal SSH workspace.</p>
          <label>
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {state.error && (
            <p role="alert" className="error">
              {state.error}
            </p>
          )}
          <button className="primary">Sign in</button>
          <small>Administrator accounts are created on the server.</small>
        </form>
      </div>
    );
  const active = state.sessions.find((s) => s.id === state.activeId);
  return (
    <div className="app-shell">
      <header className="menu-row">
        <strong>
          <Terminal size={16} /> Web SSH Workspace
        </strong>
        <button onClick={() => setTarget("")}>Terminal</button>
        <button onClick={toggleSidebar}>Sessions</button>
        <button onClick={() => setDialog("preferences")}>View</button>
        <button onClick={() => setDialog("trust")}>Host keys</button>
        <button onClick={() => setDialog("workspaces")}>Workspaces</button>
        <span className="spacer" />
        <span>{state.user.username}</span>
        <button
          title="Sign out"
          aria-label="Sign out"
          onClick={async () => {
            const current = currentOperation();
            try {
              await api("/auth/logout", { method: "POST" });
              if (current()) invalidateAuthentication();
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 401)
                return;
              if (current()) report(error);
            }
          }}
        >
          <LogOut size={16} />
        </button>
      </header>
      <form className="toolbar" onSubmit={connect}>
        <button
          type="button"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
        >
          <PanelLeft size={17} />
        </button>
        <label htmlFor="quick-connect">Quick Connect</label>
        <input
          id="quick-connect"
          placeholder="ssh user@host:22"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
        />
        <button className="primary" disabled={!state.online || busy}>
          <PlugZap size={16} />
          Connect
        </button>
        <button type="button" onClick={() => editProfile()}>
          <Plus size={15} />
          Session
        </button>
        <span className="spacer" />
        <button
          type="button"
          aria-label="Saved credentials"
          title="Saved credentials"
          onClick={() => setDialog("credentials")}
        >
          <KeyRound size={16} />
        </button>
        <button
          type="button"
          aria-label="Preferences"
          title="Preferences"
          onClick={() => setDialog("preferences")}
        >
          <Settings size={16} />
        </button>
        <button type="button" aria-label="Toggle theme" onClick={toggleTheme}>
          {state.theme === "classic-light" ? (
            <Moon size={16} />
          ) : (
            <Sun size={16} />
          )}
        </button>
      </form>
      <div className="workspace-body">
        {sidebar && (
          <>
            <aside className="sidebar" style={{ width }}>
              <SessionSidebar
                editProfile={editProfile}
                connectProfile={(profile) =>
                  createSession({
                    protocol: profile.protocol,
                    profileId: profile.id,
                  })
                }
                openWorkspaces={() => setDialog("workspaces")}
              />
            </aside>
            <div
              className="sidebar-resizer"
              role="separator"
              aria-label="Resize sidebar"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const startX = event.clientX;
                const startWidth = width;
                const element = event.currentTarget;
                let finalWidth = width;
                element.onpointermove = (move) => {
                  finalWidth = Math.max(
                    180,
                    Math.min(
                      500,
                      Math.round(startWidth + move.clientX - startX),
                    ),
                  );
                  setWidth(finalWidth);
                };
                element.onpointerup = () => {
                  element.onpointermove = null;
                  void updatePreferences({ sidebarWidth: finalWidth });
                };
              }}
            />
          </>
        )}
        <WorkspaceCanvas
          actions={{
            sources,
            close: closeSession,
            reconnect: async (session) => {
              const current = currentOperation();
              const fresh = await api(
                `/sessions/${session.id}/reconnect`,
                { method: "POST" },
                sessionDtoSchema,
              );
              if (!current()) return;
              const settings = sources.get(session.id);
              if (settings) sources.set(fresh.id, settings);
              const pane = useWorkspace.getState().panes.indexOf(session.id);
              state.upsert(fresh);
              state.removeSession(session.id);
              disposeTerminal(session.id);
              sources.delete(session.id);
              if (pane >= 0) state.moveToPane(fresh.id, pane);
              state.setActive(fresh.id);
              await attach(fresh.id);
            },
            duplicate: async (session) => {
              const current = currentOperation();
              const fresh = await api(
                `/sessions/${session.id}/duplicate`,
                { method: "POST" },
                sessionDtoSchema,
              );
              if (!current()) return;
              const settings = sources.get(session.id);
              if (settings) sources.set(fresh.id, settings);
              state.upsert(fresh);
              state.setActive(fresh.id);
              await attach(fresh.id);
            },
            disconnect: (id) => emit("session:close", { sessionId: id }),
            saveProfile: async (session) => {
              const current = currentOperation();
              const draft = await api(
                `/sessions/${session.id}/profile-draft`,
                {},
                profileInputSchema,
              );
              if (!current()) return;
              editProfile({ ...draft, id: "" });
              setPromotingSessionId(session.id);
            },
          }}
        />
      </div>
      <footer className="status-bar">
        <span className={`state-dot ${state.online ? "open" : "closed"}`} />
        {state.online ? "Browser connected" : "Browser disconnected"}
        {!state.online && (
          <button onClick={connectTransport}>Reconnect browser</button>
        )}
        <span className={state.multiExec ? "broadcast-status" : ""}>
          {state.multiExec
            ? `MultiExec ON · ${state.selectedIds.length} selected`
            : "MultiExec OFF"}
          {state.sensitive
            ? " · Sensitive Input"
            : state.singleInput
              ? " · Single-pane input"
              : ""}
        </span>
        <span className="spacer" />
        {active?.state ?? "No terminal"}
        <span>
          {state.sessions.length} session
          {state.sessions.length === 1 ? "" : "s"}
        </span>
      </footer>
      <Prompts />
      {dialog === "workspaces" && (
        <WorkspaceDialog close={() => setDialog(null)} />
      )}
      {dialog === "profile" && (
        <ProfileEditor
          profile={editing}
          close={() => {
            setDialog(null);
            setPromotingSessionId(null);
          }}
          onSaved={
            promotingSessionId
              ? async (profile) => {
                  const current = currentOperation();
                  const session = await api(
                    `/sessions/${promotingSessionId}/profile`,
                    { method: "POST", body: { profileId: profile.id } },
                    sessionDtoSchema,
                  );
                  if (!current()) return;
                  state.upsert(session);
                  sources.delete(promotingSessionId);
                  setPromotingSessionId(null);
                }
              : undefined
          }
        />
      )}
      {dialog === "preferences" && (
        <PreferencesDialog
          close={() => {
            const p = useCatalog.getState().preferences;
            setSidebar(p.sidebarVisible);
            setWidth(p.sidebarWidth);
            setDialog(null);
          }}
        />
      )}
      {dialog === "credentials" && (
        <CredentialsDialog close={() => setDialog(null)} />
      )}
      {dialog === "trust" && <TrustDialog close={() => setDialog(null)} />}
    </div>
  );
}
