import { create } from "zustand";
import type {
  AuthRequest,
  HostKeyRequest,
  SessionDto,
  User,
  WorkspaceLayout,
} from "@workspace/shared";
export type LayoutMode = WorkspaceLayout["layout"];
export const paneCount = (layout: LayoutMode) =>
  layout === "single" ? 1 : layout === "grid" ? 4 : 2;
interface WorkspaceState {
  user: User | null;
  sessions: SessionDto[];
  activeId: string | null;
  theme: "classic-light" | "classic-dark";
  online: boolean;
  error: string | null;
  hostRequests: HostKeyRequest[];
  authRequests: AuthRequest[];
  layout: LayoutMode;
  panes: (string | null)[];
  maximizedId: string | null;
  attached: string[];
  multiExec: boolean;
  selectedIds: string[];
  sensitive: boolean;
  singleInput: boolean;
  workspaceId: string | null;
  entryIds: Record<string, string>;
  setUser(user: User | null): void;
  upsert(session: SessionDto): void;
  setActive(id: string): void;
  setError(error: string | null): void;
  changeLayout(layout: LayoutMode): void;
  moveToPane(id: string, pane: number): void;
  reorder(id: string, beforeId: string): void;
  removeSession(id: string): void;
  setAttached(id: string, attached: boolean): void;
  resetBroadcast(): void;
}
export const useWorkspace = create<WorkspaceState>((set) => ({
  user: null,
  sessions: [],
  activeId: null,
  theme: "classic-light",
  online: false,
  error: null,
  hostRequests: [],
  authRequests: [],
  layout: "single",
  panes: [null],
  maximizedId: null,
  attached: [],
  multiExec: false,
  selectedIds: [],
  sensitive: false,
  singleInput: false,
  workspaceId: null,
  entryIds: {},
  setUser: (user) => set({ user }),
  upsert: (session) =>
    set((state) => {
      const added = !state.sessions.some((s) => s.id === session.id);
      const available = session.state === "OPEN";
      const panes = [...state.panes];
      if (added && panes.includes(null))
        panes[panes.indexOf(null)] = session.id;
      return {
        sessions: added
          ? [...state.sessions, session]
          : state.sessions.map((s) => (s.id === session.id ? session : s)),
        activeId: state.activeId ?? session.id,
        panes,
        selectedIds: available
          ? state.selectedIds
          : state.selectedIds.filter((id) => id !== session.id),
        attached: ["CLOSED", "FAILED", "CLOSING"].includes(session.state)
          ? state.attached.filter((id) => id !== session.id)
          : state.attached,
        entryIds: {
          ...state.entryIds,
          [session.id]:
            session.workspaceEntryId ??
            state.entryIds[session.id] ??
            crypto.randomUUID(),
        },
      };
    }),
  setActive: (activeId) =>
    set((state) => {
      const panes = [...state.panes];
      if (!panes.includes(activeId)) {
        const previous = panes.indexOf(state.activeId);
        panes[previous >= 0 ? previous : 0] = activeId;
      }
      return {
        activeId,
        panes,
        maximizedId: state.maximizedId ? activeId : null,
      };
    }),
  setError: (error) => set({ error }),
  changeLayout: (layout) =>
    set((state) => {
      const count = paneCount(layout);
      const ids = [
        ...new Set(
          [
            state.activeId,
            ...state.panes,
            ...state.sessions.map((s) => s.id),
          ].filter((id): id is string => !!id),
        ),
      ];
      return {
        layout,
        panes: Array.from({ length: count }, (_, i) => ids[i] ?? null),
        maximizedId: null,
      };
    }),
  moveToPane: (id, pane) =>
    set((state) => {
      if (
        !state.sessions.some((s) => s.id === id) ||
        pane < 0 ||
        pane >= paneCount(state.layout)
      )
        return {};
      const panes = [...state.panes];
      const previous = panes.indexOf(id);
      if (previous >= 0) panes[previous] = panes[pane] ?? null;
      panes[pane] = id;
      return { panes, activeId: id };
    }),
  reorder: (id, beforeId) =>
    set((state) => {
      if (id === beforeId) return {};
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return {};
      const sessions = state.sessions.filter((s) => s.id !== id);
      const index = sessions.findIndex((s) => s.id === beforeId);
      if (index < 0) return {};
      sessions.splice(index, 0, session);
      return { sessions };
    }),
  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const panes = state.panes.map((value) => (value === id ? null : value));
      const replacement = sessions.find((s) => !panes.includes(s.id));
      if (replacement && panes.includes(null))
        panes[panes.indexOf(null)] = replacement.id;
      const entryIds = { ...state.entryIds };
      delete entryIds[id];
      return {
        sessions,
        panes,
        entryIds,
        activeId:
          state.activeId === id
            ? (panes.find((v): v is string => !!v) ?? sessions[0]?.id ?? null)
            : state.activeId,
        selectedIds: state.selectedIds.filter((v) => v !== id),
        attached: state.attached.filter((v) => v !== id),
        maximizedId: state.maximizedId === id ? null : state.maximizedId,
      };
    }),
  setAttached: (id, attached) =>
    set((state) => ({
      attached: attached
        ? [...new Set([...state.attached, id])]
        : state.attached.filter((v) => v !== id),
      selectedIds: attached
        ? state.selectedIds
        : state.selectedIds.filter((v) => v !== id),
    })),
  resetBroadcast: () =>
    set({
      multiExec: false,
      selectedIds: [],
      sensitive: false,
      singleInput: false,
    }),
}));
