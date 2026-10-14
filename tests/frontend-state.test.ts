import { afterEach, describe, expect, it, vi } from "vitest";
import { preferencesSchema, type User } from "../packages/shared/src/index";
import {
  api,
  ApiRequestError,
  getCsrfToken,
  setCsrfToken,
  login,
} from "../apps/web/src/lib/api";
import { clearAuthentication } from "../apps/web/src/lib/authCleanup";
import {
  onAuthenticationInvalidated,
  invalidateAuthentication,
} from "../apps/web/src/lib/authLifecycle";
import { disconnectTransport } from "../apps/web/src/lib/transport";
import { disposeAllTerminals } from "../apps/web/src/lib/terminals";
vi.mock("../apps/web/src/lib/transport", () => ({
  disconnectTransport: vi.fn(),
}));
vi.mock("../apps/web/src/lib/terminals", () => ({
  disposeAllTerminals: vi.fn(),
}));
import { useCatalog } from "../apps/web/src/lib/catalog";
import { currentOperation } from "../apps/web/src/lib/operation";
import { useWorkspace } from "../apps/web/src/lib/store";
import { PendingAcknowledgements } from "../apps/web/src/lib/acknowledgements";
const user: User = {
  id: "a10eecc1-b437-452c-a19e-5c9d5369ba5f",
  username: "test",
  role: "admin",
};
function signIn(token = "first-login") {
  setCsrfToken(token);
  useWorkspace.setState({ user });
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setCsrfToken("");
  useCatalog.getState().reset();
  useWorkspace.setState({ user: null, theme: "classic-light" });
});
describe("browser login-scoped async results", () => {
  it("invalidates requests on logout and on a later login by the same user", () => {
    signIn();
    const valid = currentOperation();
    expect(valid()).toBe(true);
    useWorkspace.setState({ user: null });
    expect(valid()).toBe(false);
    signIn("second-login");
    expect(valid()).toBe(false);
  });
  it("does not restore configuration when a refresh completes after logout", async () => {
    signIn();
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        path.endsWith("/preferences")
          ? pending
          : Promise.resolve(Response.json([])),
      ),
    );
    const refresh = useCatalog.getState().refresh();
    useWorkspace.setState({ user: null });
    useCatalog.getState().reset();
    resolve(Response.json(preferencesSchema.parse({ theme: "classic-dark" })));
    await refresh;
    expect(useCatalog.getState().loaded).toBe(false);
    expect(useCatalog.getState().profiles).toEqual([]);
    expect(useWorkspace.getState().theme).toBe("classic-light");
  });
  it("ignores a preference save from a previous login", async () => {
    signIn();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const save = useCatalog
      .getState()
      .savePreferences(preferencesSchema.parse({ theme: "classic-dark" }));
    signIn("second-login");
    resolve(Response.json(preferencesSchema.parse({ theme: "classic-dark" })));
    await save;
    expect(useCatalog.getState().preferences.theme).toBe("classic-light");
    expect(useWorkspace.getState().theme).toBe("classic-light");
  });
});

describe("terminal output disposal", () => {
  it("settles queued output on disposal and ignores subsequent parser callbacks", () => {
    const pending = new PendingAcknowledgements();
    const first = vi.fn();
    const second = vi.fn();
    const parserCallback = pending.track(first);
    pending.track(second);
    pending.flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    parserCallback();
    pending.flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("expired browser authentication", () => {
  it.each(["/auth/logout", "/profiles"])(
    "clears authenticated browser resources when %s returns 401",
    async (path) => {
      signIn();
      useCatalog.setState({ loaded: true });
      useWorkspace.setState({ online: true, theme: "classic-dark" });
      const remove = onAuthenticationInvalidated(clearAuthentication);
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            Response.json(
              {
                error: {
                  code: "UNAUTHORIZED",
                  message: "Authentication required",
                },
              },
              { status: 401 },
            ),
          ),
        ),
      );
      try {
        await expect(
          api(path, { method: path === "/auth/logout" ? "POST" : "GET" }),
        ).rejects.toBeInstanceOf(ApiRequestError);
        expect(useWorkspace.getState().user).toBeNull();
        expect(useWorkspace.getState().online).toBe(false);
        expect(useWorkspace.getState().sessions).toEqual([]);
        expect(useWorkspace.getState().authRequests).toEqual([]);
        expect(useCatalog.getState().loaded).toBe(false);
        expect(getCsrfToken()).toBe("");
        expect(disconnectTransport).toHaveBeenCalledTimes(1);
        expect(disposeAllTerminals).toHaveBeenCalledTimes(1);
      } finally {
        remove();
      }
    },
  );
  it("retains the current login on a network/server error", async () => {
    signIn();
    const cleanup = vi.fn(clearAuthentication);
    const remove = onAuthenticationInvalidated(cleanup);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: { code: "INTERNAL_ERROR", message: "Unavailable" } },
            { status: 503 },
          ),
        ),
      ),
    );
    try {
      await expect(
        api("/auth/logout", { method: "POST" }),
      ).rejects.toMatchObject({ status: 503 });
      expect(cleanup).not.toHaveBeenCalled();
      expect(useWorkspace.getState().user).toEqual(user);
    } finally {
      remove();
    }
  });
  it("does not sign out a fresh login when an old request returns 401", async () => {
    signIn();
    const remove = onAuthenticationInvalidated(clearAuthentication);
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = api("/profiles");
    signIn("second-login");
    resolve(
      Response.json(
        { error: { code: "SESSION_EXPIRED", message: "Expired" } },
        { status: 401 },
      ),
    );
    try {
      await expect(request).rejects.toMatchObject({ status: 401 });
      expect(useWorkspace.getState().user).toEqual(user);
      expect(getCsrfToken()).toBe("second-login");
      expect(disconnectTransport).not.toHaveBeenCalled();
    } finally {
      remove();
    }
  });
  it("discards a login response that arrives after authentication invalidation", async () => {
    const remove = onAuthenticationInvalidated(clearAuthentication);
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = login("test", "password");
    invalidateAuthentication();
    resolve(Response.json({ user, csrfToken: "old-response" }));
    try {
      await expect(request).rejects.toMatchObject({
        status: 401,
        error: { code: "SESSION_EXPIRED" },
      });
      expect(useWorkspace.getState().user).toBeNull();
      expect(getCsrfToken()).toBe("");
    } finally {
      remove();
    }
  });
});
