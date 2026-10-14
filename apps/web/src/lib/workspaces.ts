import {
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type Workspace,
  workspaceRestoreSchema,
  sessionDtoSchema,
} from "@workspace/shared";
import { api } from "./api";
import { useWorkspace } from "./store";
import { attach } from "./transport";
import { currentOperation } from "./operation";
export function savedLayout(): WorkspaceLayout {
  const state = useWorkspace.getState();
  const entries = state.sessions
    .filter((session) => session.profileId)
    .map((session) => ({
      id:
        state.entryIds[session.id] ??
        session.workspaceEntryId ??
        crypto.randomUUID(),
      profileId: session.profileId!,
      pane: state.panes.includes(session.id)
        ? state.panes.indexOf(session.id)
        : null,
    }));
  return workspaceLayoutSchema.parse({
    version: 1,
    layout: state.layout,
    entries,
    activeEntryId:
      entries.find((entry) => entry.id === state.entryIds[state.activeId ?? ""])
        ?.id ?? null,
  });
}
export async function bindWorkspaceSessions(workspace: Workspace) {
  const current = currentOperation();
  const state = useWorkspace.getState();
  for (const entry of workspace.layout.entries) {
    if (!current()) return;
    const session = state.sessions.find(
      (session) => state.entryIds[session.id] === entry.id,
    );
    if (!session || ["CLOSED", "FAILED", "CLOSING"].includes(session.state))
      continue;
    const updated = await api(
      `/sessions/${session.id}/workspace`,
      {
        method: "PUT",
        body: { workspaceId: workspace.id, workspaceEntryId: entry.id },
      },
      sessionDtoSchema,
    );
    if (!current()) return;
    useWorkspace.getState().upsert(updated);
  }
  if (current()) useWorkspace.setState({ workspaceId: workspace.id });
}
export function applyWorkspaceLayout(
  workspace: Workspace,
  entrySessions: Map<string, string>,
) {
  const layout = workspace.layout;
  const count =
    layout.layout === "grid" ? 4 : layout.layout === "single" ? 1 : 2;
  const panes: (string | null)[] = Array.from({ length: count }, () => null);
  for (const entry of layout.entries)
    if (entry.pane !== null && entry.pane < count)
      panes[entry.pane] = entrySessions.get(entry.id) ?? null;
  const active = layout.activeEntryId
    ? entrySessions.get(layout.activeEntryId)
    : undefined;
  const ordered = [...entrySessions.values()];
  const sessions = useWorkspace.getState().sessions;
  useWorkspace.setState({
    workspaceId: workspace.id,
    layout: layout.layout,
    panes,
    maximizedId: null,
    activeId:
      active ?? panes.find((id): id is string => !!id) ?? ordered[0] ?? null,
    sessions: [
      ...ordered
        .map((id) => sessions.find((session) => session.id === id)!)
        .filter(Boolean),
      ...sessions.filter((session) => !ordered.includes(session.id)),
    ],
    multiExec: false,
    selectedIds: [],
  });
}
export async function restoreWorkspace(workspace: Workspace) {
  const current = currentOperation();
  useWorkspace.getState().resetBroadcast();
  const response = await api(
    `/workspaces/${workspace.id}/restore`,
    { method: "POST" },
    workspaceRestoreSchema,
  );
  if (!current()) return;
  const state = useWorkspace.getState();
  const entrySessions = new Map<string, string>();
  const errors: string[] = [];
  for (const entry of response.entries) {
    if (!current()) return;
    if (entry.session) {
      state.upsert(entry.session);
      entrySessions.set(entry.entryId, entry.session.id);
      try {
        await attach(entry.session.id);
      } catch (error) {
        errors.push(String(error));
      }
    } else if (entry.error) errors.push(entry.error.message);
  }
  if (!current()) return;
  applyWorkspaceLayout(response.workspace, entrySessions);
  useWorkspace.setState({ error: errors.length ? errors.join("; ") : null });
}
