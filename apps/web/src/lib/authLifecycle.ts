import type { ApiError } from "@workspace/shared";
type Listener = (error?: ApiError) => void;
const listeners = new Set<Listener>();
let revision = 0;
export function authenticationRevision() {
  return revision;
}
export function onAuthenticationInvalidated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Composition registers local cleanup; transports stay independent of stores and UI. */
export function invalidateAuthentication(error?: ApiError) {
  revision++;
  for (const listener of listeners) listener(error);
}
export function isAuthenticationError(error: ApiError): boolean {
  return error.code === "UNAUTHORIZED" || error.code === "SESSION_EXPIRED";
}
