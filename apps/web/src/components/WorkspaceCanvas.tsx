import { useEffect, useState } from "react";
import { X, Maximize2, Minimize2, Terminal } from "lucide-react";
import type { SessionDto, SshSettings } from "@workspace/shared";
import { useWorkspace } from "../lib/store";
import { useCatalog } from "../lib/catalog";
import { TerminalView } from "./TerminalView";
import { TerminalControls } from "./TerminalControls";
import { terminalActions } from "../lib/protocols";
import { MultiExecControls } from "./MultiExecControls";
interface Actions {
  close(id: string): Promise<void>;
  reconnect(session: SessionDto): Promise<void>;
  duplicate(session: SessionDto): Promise<void>;
  disconnect(id: string): Promise<void>;
  saveProfile(session: SessionDto): Promise<void>;
  sources: Map<string, SshSettings>;
}
export function WorkspaceCanvas({ actions }: { actions: Actions }) {
  const state = useWorkspace();
  const catalog = useCatalog();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [info, setInfo] = useState<string | null>(null);
  const report = (error: unknown) => state.setError(String(error));
  const run = (promise: Promise<void>) => promise.catch(report);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const pageCycle =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "PageUp" || event.key === "PageDown");
      const tabCycle = (event.ctrlKey || event.metaKey) && event.key === "Tab";
      if (!pageCycle && !tabCycle) return;
      // Application shortcuts never steal focus from dialogs or ordinary form editing.
      const target = event.target instanceof Element ? event.target : null;
      if (document.querySelector('[role="dialog"]')) {
        if (target?.classList.contains("xterm-helper-textarea")) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (
        target &&
        !target.classList.contains("xterm-helper-textarea") &&
        (target.closest("input, textarea, select") ||
          (target instanceof HTMLElement && target.isContentEditable))
      )
        return;
      const current = useWorkspace.getState();
      if (!current.sessions.length) return;
      event.preventDefault();
      event.stopPropagation();
      const index = current.sessions.findIndex(
        (session) => session.id === current.activeId,
      );
      const backwards = pageCycle ? event.key === "PageUp" : event.shiftKey;
      current.setActive(
        current.sessions[
          (index + (backwards ? -1 : 1) + current.sessions.length) %
            current.sessions.length
        ]!.id,
      );
    };
    // Capture before xterm receives Alt+Page keys and turns them into remote escape sequences.
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);
  const contextSession = state.sessions.find(
    (session) => session.id === menu?.id,
  );
  return (
    <main className="terminal-area">
      <div className="tab-strip" role="tablist" aria-label="Terminal sessions">
        {state.sessions.map((session) => (
          <div
            role="tab"
            tabIndex={session.id === state.activeId ? 0 : -1}
            aria-selected={session.id === state.activeId}
            data-session-id={session.id}
            className={`terminal-tab ${session.id === state.activeId ? "active" : ""}`}
            key={session.id}
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData("text/x-workspace-session", session.id)
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              state.reorder(
                event.dataTransfer.getData("text/x-workspace-session"),
                session.id,
              );
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void run(actions.close(session.id));
              }
            }}
            onClick={() => state.setActive(session.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                state.setActive(session.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({
                id: session.id,
                x: Math.min(event.clientX, window.innerWidth - 210),
                y: Math.min(event.clientY, window.innerHeight - 270),
              });
            }}
          >
            <span className={`state-dot ${session.state.toLowerCase()}`} />
            <span>{session.name}</span>
            <button
              aria-label={`Session actions ${session.name}`}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({
                  id: session.id,
                  x: Math.min(rect.left, window.innerWidth - 210),
                  y: Math.min(rect.bottom, window.innerHeight - 270),
                });
              }}
            >
              ⋮
            </button>
            <button
              aria-label={`Close ${session.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void run(actions.close(session.id));
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {state.error && (
        <div className="error-banner" role="alert">
          {state.error}
          <button
            aria-label="Dismiss error"
            onClick={() => state.setError(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="layout-controls">
        <label>
          Layout{" "}
          <select
            aria-label="Terminal layout"
            value={state.layout}
            onChange={(event) =>
              state.changeLayout(event.target.value as typeof state.layout)
            }
          >
            <option value="single">Single pane</option>
            <option value="horizontal">Two panes · top/bottom</option>
            <option value="vertical">Two panes · side by side</option>
            <option value="grid">Four panes</option>
          </select>
        </label>
        <span className="spacer" />
        <span>
          Drag tabs onto panes · Alt+PageUp / PageDown switches terminals
        </span>
      </div>
      <MultiExecControls />
      {state.sessions.length ? (
        <div
          className={`pane-grid layout-${state.layout} ${state.maximizedId ? "pane-maximized" : ""}`}
        >
          {state.panes.map((id, index) => {
            const session = state.sessions.find((item) => item.id === id);
            const selected = id && state.selectedIds.includes(id);
            const profile = catalog.profiles.find(
              (profile) => profile.id === session?.profileId,
            );
            return (
              <section
                key={index}
                role="group"
                aria-label={
                  session
                    ? `Terminal pane ${session.name}`
                    : `Empty pane ${index + 1}`
                }
                data-session-id={id ?? undefined}
                data-pane={index}
                className={`terminal-pane ${id === state.activeId ? "focused" : ""} ${state.multiExec ? (selected ? "broadcast-selected" : "broadcast-excluded") : ""}`}
                style={{
                  display:
                    state.maximizedId && id !== state.maximizedId
                      ? "none"
                      : undefined,
                }}
                onPointerDown={() => {
                  if (id && state.activeId !== id) state.setActive(id);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  state.moveToPane(
                    event.dataTransfer.getData("text/x-workspace-session"),
                    index,
                  );
                }}
              >
                {session ? (
                  <>
                    <div className="pane-header">
                      <span>
                        {session.username}@{session.host}:{session.port}
                      </span>
                      {state.multiExec && (
                        <strong>{selected ? "SELECTED" : "EXCLUDED"}</strong>
                      )}
                      <span>{session.state}</span>
                      <button
                        aria-label={`${state.maximizedId === id ? "Restore" : "Maximize"} pane ${session.name}`}
                        onClick={() =>
                          useWorkspace.setState({
                            maximizedId: state.maximizedId === id ? null : id,
                          })
                        }
                      >
                        {state.maximizedId === id ? (
                          <Minimize2 size={12} />
                        ) : (
                          <Maximize2 size={12} />
                        )}
                      </button>
                    </div>
                    {id === state.activeId && (
                      <>
                        <div className="terminal-actions">
                          <button
                            disabled={!state.online}
                            onClick={() => void run(actions.reconnect(session))}
                          >
                            Reconnect
                          </button>
                          <button
                            disabled={
                              !state.online ||
                              ["CLOSED", "FAILED", "CLOSING"].includes(
                                session.state,
                              )
                            }
                            onClick={() =>
                              void run(actions.disconnect(session.id))
                            }
                          >
                            Disconnect
                          </button>
                          <button
                            disabled={!state.online}
                            onClick={() => void run(actions.duplicate(session))}
                          >
                            Duplicate
                          </button>
                          {!session.profileId && (
                            <button
                              onClick={() =>
                                void run(actions.saveProfile(session))
                              }
                            >
                              Save as profile
                            </button>
                          )}
                          <label>
                            Move to pane{" "}
                            <select
                              aria-label={`Move ${session.name} to pane`}
                              value={index}
                              onChange={(event) =>
                                state.moveToPane(
                                  session.id,
                                  Number(event.target.value),
                                )
                              }
                            >
                              {state.panes.map((_, pane) => (
                                <option value={pane} key={pane}>
                                  {pane + 1}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {terminalActions(session).terminal && (
                          <TerminalControls session={session} />
                        )}
                      </>
                    )}
                    {terminalActions(session).terminal && (
                      <TerminalView
                        sessionId={session.id}
                        active={id === state.activeId}
                        terminalOptions={
                          session.terminal ??
                          profile?.settings.terminal ??
                          actions.sources.get(session.id)?.terminal ??
                          catalog.preferences.terminal
                        }
                        appearance={catalog.preferences.appearance}
                        resize={terminalActions(session).resize}
                      />
                    )}
                    {session.error && (
                      <div className="session-error" role="alert">
                        {session.error.code}: {session.error.message}
                        {session.error.details && (
                          <pre>
                            {JSON.stringify(session.error.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-workspace">
                    <Terminal size={25} />
                    <p>Drop a session tab here</p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="empty-workspace">
          <Terminal size={40} />
          <h2>Ready to connect</h2>
          <p>Enter an SSH target in Quick Connect or choose a saved profile.</p>
          <kbd>ssh user@host</kbd>
          <small>Host keys are verified before authentication.</small>
        </div>
      )}
      {menu && contextSession && (
        <div
          role="menu"
          aria-label={`Actions ${contextSession.name}`}
          className="session-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            role="menuitem"
            disabled={!state.online}
            onClick={() => void run(actions.duplicate(contextSession))}
          >
            Duplicate
          </button>
          <button
            role="menuitem"
            disabled={!state.online}
            onClick={() => void run(actions.reconnect(contextSession))}
          >
            Reconnect
          </button>
          <button role="menuitem" onClick={() => setInfo(contextSession.id)}>
            Session information
          </button>
          {state.panes.map((_, index) => (
            <button
              role="menuitem"
              key={index}
              onClick={() => state.moveToPane(contextSession.id, index)}
            >
              Move to pane {index + 1}
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => void run(actions.close(contextSession.id))}
          >
            Close
          </button>
        </div>
      )}
      {info && (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Session information"
          >
            <h2>Session information</h2>
            <pre>
              {JSON.stringify(
                state.sessions.find((session) => session.id === info),
                null,
                2,
              )}
            </pre>
            <footer>
              <button onClick={() => setInfo(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
