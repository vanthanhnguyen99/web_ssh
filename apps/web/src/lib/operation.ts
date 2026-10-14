import { getCsrfToken } from "./api";
import { useWorkspace } from "./store";
/** Async results are valid only for the login that started them. */
export function currentOperation(): () => boolean {
  const userId = useWorkspace.getState().user?.id;
  const csrfToken = getCsrfToken();
  return () =>
    !!userId &&
    useWorkspace.getState().user?.id === userId &&
    getCsrfToken() === csrfToken;
}
