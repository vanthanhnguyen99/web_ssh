import { useWorkspace } from "../lib/store";
import { terminalActions } from "../lib/protocols";
import { broadcastActivationSchema } from "@workspace/shared";
import { api } from "../lib/api";
import { currentOperation } from "../lib/operation";
export function MultiExecControls() {
  const state = useWorkspace();
  const available = state.sessions.filter(
    (session) =>
      session.state === "OPEN" &&
      state.attached.includes(session.id) &&
      terminalActions(session).terminal,
  );
  const blocked =
    !state.online || !!state.authRequests.length || !!state.hostRequests.length;
  function recordActivation(enabled: boolean, sessionIds: string[]) {
    const current = currentOperation();
    void api("/broadcast", {
      method: "POST",
      body: broadcastActivationSchema.parse({ enabled, sessionIds }),
    }).catch((error) => {
      if (current())
        useWorkspace
          .getState()
          .setError(`MultiExec audit unavailable: ${String(error)}`);
    });
  }
  return (
    <div
      className={`multiexec-controls ${state.multiExec ? "broadcast-on" : ""}`}
    >
      <button
        aria-pressed={state.multiExec}
        disabled={blocked || state.sensitive}
        onClick={() => {
          const enabled = !state.multiExec;
          useWorkspace.setState({ multiExec: enabled, selectedIds: [] });
          recordActivation(enabled, enabled ? [] : state.selectedIds);
        }}
      >
        MultiExec {state.multiExec ? "ON" : "OFF"}
      </button>
      {state.multiExec && (
        <>
          <strong>{state.selectedIds.length} selected targets</strong>
          <button
            disabled={blocked}
            onClick={() =>
              useWorkspace.setState({
                selectedIds: available.map((session) => session.id),
              })
            }
          >
            Select all
          </button>
          <button onClick={() => useWorkspace.setState({ selectedIds: [] })}>
            Select none
          </button>
          <div className="target-list">
            {state.sessions.map((session) => (
              <label key={session.id}>
                <input
                  type="checkbox"
                  checked={state.selectedIds.includes(session.id)}
                  disabled={
                    !available.some((target) => target.id === session.id) ||
                    blocked
                  }
                  onChange={(e) =>
                    useWorkspace.setState({
                      selectedIds: e.target.checked
                        ? [...state.selectedIds, session.id]
                        : state.selectedIds.filter((id) => id !== session.id),
                    })
                  }
                />
                {session.name}
              </label>
            ))}
          </div>
        </>
      )}
      {state.singleInput && state.multiExec && (
        <strong>Single-pane input active · broadcast suspended</strong>
      )}
      {(state.authRequests.length > 0 || state.hostRequests.length > 0) && (
        <strong>Verification dialog · terminal input suspended</strong>
      )}
      <span className="spacer" />
      <button
        aria-pressed={state.singleInput}
        onClick={() =>
          useWorkspace.setState({ singleInput: !state.singleInput })
        }
      >
        Single-pane input {state.singleInput ? "ON" : "OFF"}
      </button>
      <button
        aria-pressed={state.sensitive}
        onClick={() => {
          useWorkspace.setState({
            sensitive: !state.sensitive,
            multiExec: false,
            selectedIds: [],
          });
          if (state.multiExec) recordActivation(false, state.selectedIds);
        }}
      >
        Sensitive Input {state.sensitive ? "ON" : "OFF"}
      </button>
    </div>
  );
}
