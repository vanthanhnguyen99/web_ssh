import { useState } from "react";
import { workspaceInputSchema, workspaceSchema } from "@workspace/shared";
import { Dialog } from "./ConfigurationDialogs";
import { useCatalog } from "../lib/catalog";
import { useWorkspace } from "../lib/store";
import { api } from "../lib/api";
import {
  savedLayout,
  restoreWorkspace,
  bindWorkspaceSessions,
} from "../lib/workspaces";
import { currentOperation } from "../lib/operation";
export function WorkspaceDialog({ close }: { close(): void }) {
  const catalog = useCatalog();
  const state = useWorkspace();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function action(run: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Workspaces" close={close}>
      <p>
        Save profile references, tab order, and pane positions. Save Quick
        Connect sessions as profiles first. MultiExec always restores off.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            const current = currentOperation();
            const workspace = await api(
              "/workspaces",
              {
                method: "POST",
                body: workspaceInputSchema.parse({
                  name,
                  layout: savedLayout(),
                }),
              },
              workspaceSchema,
            );
            if (!current()) return;
            await bindWorkspaceSessions(workspace);
            await catalog.refresh();
            setName("");
          });
        }}
      >
        <label>
          Workspace name
          <input
            required
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={
            busy || !state.sessions.some((session) => session.profileId)
          }
        >
          Save new workspace
        </button>
      </form>
      <div className="record-list">
        {catalog.workspaces.map((workspace) => (
          <div key={workspace.id}>
            <span>
              {workspace.name}
              <small> · {workspace.layout.entries.length} profiles</small>
            </span>
            <button
              disabled={busy || !state.online}
              onClick={() =>
                void action(async () => {
                  await restoreWorkspace(workspace);
                  close();
                })
              }
            >
              Restore
            </button>
            <button
              disabled={
                busy || !state.sessions.some((session) => session.profileId)
              }
              onClick={() =>
                void action(async () => {
                  if (
                    !window.confirm(
                      `Replace layout of “${workspace.name}” with the current layout?`,
                    )
                  )
                    return;
                  const updated = await api(
                    `/workspaces/${workspace.id}`,
                    {
                      method: "PUT",
                      body: { name: workspace.name, layout: savedLayout() },
                    },
                    workspaceSchema,
                  );
                  await bindWorkspaceSessions(updated);
                  await catalog.refresh();
                })
              }
            >
              Update
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const name = window.prompt("Workspace name", workspace.name);
                  if (!name) return;
                  await api(`/workspaces/${workspace.id}`, {
                    method: "PUT",
                    body: { name, layout: workspace.layout },
                  });
                  await catalog.refresh();
                })
              }
            >
              Rename
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (!window.confirm(`Delete workspace “${workspace.name}”?`))
                    return;
                  await api(`/workspaces/${workspace.id}`, {
                    method: "DELETE",
                  });
                  await catalog.refresh();
                })
              }
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
