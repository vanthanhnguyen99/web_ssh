import { setCsrfToken } from "./api";
import { useCatalog } from "./catalog";
import { useWorkspace } from "./store";
import { disconnectTransport } from "./transport";
import { disposeAllTerminals } from "./terminals";
/** All authenticated browser resources are owned by the current login. */
export function clearAuthentication() {
  setCsrfToken("");
  disconnectTransport();
  disposeAllTerminals();
  useCatalog.getState().reset();
  useWorkspace.setState({
    user: null,
    sessions: [],
    activeId: null,
    hostRequests: [],
    authRequests: [],
    error: null,
    theme: "classic-light",
    online: false,
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
  });
}
