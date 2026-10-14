import {
  apiErrorSchema,
  meSchema,
  type ApiError,
  type User,
} from "@workspace/shared";
import {
  authenticationRevision,
  invalidateAuthentication,
  isAuthenticationError,
} from "./authLifecycle";
let csrfToken = "";
export function setCsrfToken(value: string) {
  csrfToken = value;
}
export function getCsrfToken() {
  return csrfToken;
}
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
    this.name = "ApiRequestError";
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
  schema?: { parse(value: unknown): T },
): Promise<T> {
  const requestToken = csrfToken;
  const requestRevision = authenticationRevision();
  const response = await fetch("/api" + path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(requestToken ? { "x-csrf-token": requestToken } : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      value && typeof value === "object" && "error" in value
        ? value.error
        : undefined,
    );
    const error: ApiError = parsed.success
      ? parsed.data
      : {
          code: response.status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
          message: `Request failed (HTTP ${response.status})`,
        };
    if (
      (response.status === 401 || isAuthenticationError(error)) &&
      requestToken === csrfToken &&
      requestRevision === authenticationRevision()
    ) {
      csrfToken = "";
      invalidateAuthentication(error);
    }
    throw new ApiRequestError(response.status, error);
  }
  return schema ? schema.parse(value) : (value as T);
}
async function authenticatedUser(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<User> {
  const revision = authenticationRevision();
  const result = await api(path, options, meSchema);
  if (revision !== authenticationRevision())
    throw new ApiRequestError(401, {
      code: "SESSION_EXPIRED",
      message: "Sign in again to continue",
    });
  setCsrfToken(result.csrfToken);
  return result.user;
}
export function currentUser(): Promise<User> {
  return authenticatedUser("/me");
}
export function login(username: string, password: string): Promise<User> {
  return authenticatedUser("/auth/login", {
    method: "POST",
    body: { username, password },
  });
}
