import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../apps/server/src/infrastructure/database.js";
import { createAdministrator } from "../../apps/server/src/infrastructure/bootstrap.js";
import type {
  SessionDto,
  Profile,
  Workspace,
} from "../../packages/shared/src/index.js";
async function paste(page: Page, sessionId: string, text: string) {
  await page
    .locator(
      `[role="group"][data-session-id="${sessionId}"] .xterm-helper-textarea`,
    )
    .evaluate((element, value) => {
      // Firefox protects synthetic DataTransfer contents; provide the clipboard
      // contract directly while exercising the production native paste handler.
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: () => value },
      });
      element.dispatchEvent(event);
    }, text);
}
test("eight DUT workspace: fixed panes, selective input, paste safety, themes and connectivity recovery", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  const inputFrames: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (
        typeof frame.payload === "string" &&
        frame.payload.includes('"terminal:input"')
      )
        inputFrames.push(frame.payload);
    }),
  );
  const username = `workspace-${testInfo.project.name}-${randomUUID()}`;
  const database = createDatabase(
    process.env.TEST_DATABASE_URL ??
      "postgres://workspace:workspace_test@127.0.0.1:55433/workspace_test",
  );
  await createAdministrator(
    database.db,
    username,
    "workspace-browser-password",
  );
  await database.pool.end();
  await page.goto("/");
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Username").fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill("workspace-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await response).json()).csrfToken as string;
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  async function api<T>(
    path: string,
    method = "GET",
    data?: unknown,
  ): Promise<T> {
    const response = await page.request.fetch(`/api${path}`, {
      method,
      headers: { origin: "http://localhost:5173", "x-csrf-token": csrf },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const credential = await api<{ id: string }>("/credentials", "POST", {
    name: "fixture",
    material: { type: "password", password: "fixture-password" },
  });
  const profiles: Profile[] = [];
  for (let i = 0; i < 8; i++)
    profiles.push(
      await api<Profile>("/profiles", "POST", {
        protocol: "ssh",
        name: `DUT${i + 1}`,
        settings: { host: "127.0.0.1", port: 22222, username: "lab" },
        credentialId: credential.id,
      }),
    );
  const entries = profiles.map((profile, i) => ({
    id: randomUUID(),
    profileId: profile.id,
    pane: i < 4 ? i : null,
  }));
  const workspace = await api<Workspace>("/workspaces", "POST", {
    name: "Eight DUTs",
    layout: {
      version: 1,
      layout: "grid",
      activeEntryId: entries[0]!.id,
      entries,
    },
  });
  await page.reload();
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await page.getByRole("button", { name: workspace.name, exact: true }).click();
  // Each unknown key is accepted explicitly. Saved credentials never enter browser storage.
  for (let i = 0; i < 8; i++) {
    await expect(
      page.getByRole("dialog", { name: "Verify SSH host key" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Accept key", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await api<SessionDto[]>("/sessions")).filter(
            (session) => session.state === "OPEN",
          ).length,
      )
      .toBeGreaterThanOrEqual(i + 1);
    await expect(
      page.getByRole("dialog", { name: "SSH authentication" }),
    ).toHaveCount(0);
  }
  await expect
    .poll(
      async () =>
        (await api<SessionDto[]>("/sessions")).filter((s) => s.state === "OPEN")
          .length,
    )
    .toBe(8);
  await expect(page.getByRole("tab")).toHaveCount(8);
  await expect(page.locator('[role="group"][data-session-id]')).toHaveCount(4);
  await expect(page.getByLabel("Terminal layout")).toHaveValue("grid");
  const sessions = await api<SessionDto[]>("/sessions");
  const ids = profiles.map(
    (profile) => sessions.find((s) => s.profileId === profile.id)!.id,
  );
  const pane = (index: number) =>
    page.locator(`[role="group"][data-session-id="${ids[index]}"]`);
  const screen = (index: number) => pane(index).locator(".xterm-screen");
  const activeTab = page.locator('[role="tab"][aria-selected="true"]');
  const stabilize = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  // Verify shortcuts are intercepted before xterm can emit remote escape sequences.
  await expect(activeTab).toHaveAttribute("data-session-id", ids[0]!);
  inputFrames.length = 0;
  await pane(0).locator(".xterm-helper-textarea").press("Alt+PageDown");
  await expect(activeTab).toHaveAttribute("data-session-id", ids[1]!);
  await stabilize();
  expect(inputFrames).toEqual([]);
  await pane(1)
    .locator(".xterm-helper-textarea")
    .pressSequentially("printf __KEYBOARD_FOCUSED_ONLY__");
  await pane(1).locator(".xterm-helper-textarea").press("Enter");
  await expect(screen(1)).toContainText("__KEYBOARD_FOCUSED_ONLY__");
  await expect(screen(0)).not.toContainText("__KEYBOARD_FOCUSED_ONLY__");
  inputFrames.length = 0;
  await pane(1).locator(".xterm-helper-textarea").press("Alt+PageUp");
  await expect(activeTab).toHaveAttribute("data-session-id", ids[0]!);
  await stabilize();
  expect(inputFrames).toEqual([]);
  await pane(0).getByLabel("Search terminal").press("Alt+PageDown");
  await expect(activeTab).toHaveAttribute("data-session-id", ids[0]!);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  // A retained or programmatically focused background terminal must stay inert behind dialogs.
  await pane(0).locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Alt+PageDown");
  await expect(activeTab).toHaveAttribute("data-session-id", ids[0]!);
  await stabilize();
  expect(inputFrames).toEqual([]);
  await page.getByLabel("Terminal font size").press("Alt+PageDown");
  await expect(
    page.getByRole("dialog", { name: "Workspace preferences" }),
  ).toBeVisible();
  await expect(activeTab).toHaveAttribute("data-session-id", ids[0]!);
  await page
    .getByRole("button", { name: "Close Workspace preferences", exact: true })
    .click();
  await stabilize();
  expect(inputFrames).toEqual([]);
  await page
    .getByRole("button", { name: "MultiExec OFF", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "DUT1", exact: true }).check();
  await page.getByRole("checkbox", { name: "DUT2", exact: true }).check();
  await expect(
    page.getByText("2 selected targets", { exact: true }),
  ).toBeVisible();
  await pane(0)
    .locator(".xterm-helper-textarea")
    .pressSequentially("printf __SELECTIVE_TWO__");
  await pane(0).locator(".xterm-helper-textarea").press("Enter");
  await expect(screen(0)).toContainText("__SELECTIVE_TWO__");
  await expect(screen(1)).toContainText("__SELECTIVE_TWO__");
  await expect(screen(2)).not.toContainText("__SELECTIVE_TWO__");
  await expect(screen(3)).not.toContainText("__SELECTIVE_TWO__");
  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("confirm");
    void dialog.dismiss();
  });
  await paste(page, ids[0]!, "printf __CANCELLED_PASTE__\n");
  await expect(screen(0)).not.toContainText("__CANCELLED_PASTE__");
  await expect(screen(1)).not.toContainText("__CANCELLED_PASTE__");
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("2 selected terminal");
    void dialog.accept();
  });
  await paste(page, ids[0]!, "printf __CONFIRMED_PASTE__\n");
  await expect(screen(0)).toContainText("__CONFIRMED_PASTE__");
  await expect(screen(1)).toContainText("__CONFIRMED_PASTE__");
  await expect(screen(2)).not.toContainText("__CONFIRMED_PASTE__");
  for (const theme of ["classic-light", "classic-dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({
      path: testInfo.outputPath(`${theme}-four-pane-selected.png`),
      fullPage: true,
    });
    await expect(page).toHaveScreenshot(`${theme}-four-pane-selected.png`, {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [
        page.getByText(username, { exact: true }),
        page.locator(".xterm-screen"),
      ],
      maxDiffPixelRatio: 0.005,
    });
  }
  await page
    .getByRole("button", { name: "Sensitive Input OFF", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "MultiExec OFF", exact: true }),
  ).toBeDisabled();
  await pane(0)
    .locator(".xterm-helper-textarea")
    .pressSequentially("printf __SENSITIVE_ONLY__");
  await pane(0).locator(".xterm-helper-textarea").press("Enter");
  await expect(screen(0)).toContainText("__SENSITIVE_ONLY__");
  await expect(screen(1)).not.toContainText("__SENSITIVE_ONLY__");
  await page
    .getByRole("button", { name: "Sensitive Input ON", exact: true })
    .click();
  await page
    .getByRole("button", { name: "MultiExec OFF", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "DUT1", exact: true }).check();
  await page.getByRole("checkbox", { name: "DUT2", exact: true }).check();
  await context.setOffline(true);
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser disconnected",
  );
  await expect(
    page.getByRole("button", { name: "MultiExec OFF", exact: true }),
  ).toBeVisible();
  await pane(0)
    .locator(".xterm-helper-textarea")
    .pressSequentially("printf __OFFLINE_DISCARDED__");
  await pane(0).locator(".xterm-helper-textarea").press("Enter");
  await context.setOffline(false);
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await expect
    .poll(
      async () =>
        (await api<SessionDto[]>("/sessions")).filter((s) => s.state === "OPEN")
          .length,
    )
    .toBe(8);
  await page.reload();
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await expect(page.getByRole("tab")).toHaveCount(8);
  await expect(page.getByLabel("Terminal layout")).toHaveValue("grid");
  await expect(page.locator('[role="group"][data-session-id]')).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "MultiExec OFF", exact: true }),
  ).toBeVisible();
  expect(
    (await api<SessionDto[]>("/sessions")).map((s) => s.id).sort(),
  ).toEqual([...ids].sort());
  await expect(screen(0)).toContainText("__SELECTIVE_TWO__");
  await expect(screen(0)).not.toContainText("__OFFLINE_DISCARDED__");
  await expect(screen(1)).not.toContainText("__OFFLINE_DISCARDED__");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("save a live Quick Connect profile and workspace without replacing the terminal", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const username = `promote-${testInfo.project.name}-${randomUUID()}`;
  const database = createDatabase(
    process.env.TEST_DATABASE_URL ??
      "postgres://workspace:workspace_test@127.0.0.1:55433/workspace_test",
  );
  await createAdministrator(
    database.db,
    username,
    "workspace-browser-password",
  );
  await database.pool.end();
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill("workspace-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await page.getByLabel("Quick Connect").fill("lab@127.0.0.1:22222");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Verify SSH host key" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept key", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Authenticate", exact: true }).click();
  await expect(page.locator(".pane-header")).toContainText("OPEN");
  const original = await page.getByRole("tab").getAttribute("data-session-id");
  await page.reload();
  await expect(page.locator(".pane-header")).toContainText("OPEN");
  await page
    .getByRole("button", { name: "Save as profile", exact: true })
    .click();
  await page.getByLabel("Profile name").fill("Promoted DUT");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("tab")).toContainText("Promoted DUT");
  await expect(page.getByRole("tab")).toHaveAttribute(
    "data-session-id",
    original!,
  );
  await expect(
    page.getByRole("button", { name: "Save as profile", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByLabel("Workspace name").fill("Promoted workspace");
  await page
    .getByRole("button", { name: "Save new workspace", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Workspaces" })).toContainText(
    "Promoted workspace",
  );
  await page
    .getByRole("button", { name: "Close Workspaces", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".pane-header")).toContainText("OPEN");
  await expect(page.getByRole("tab")).toHaveAttribute(
    "data-session-id",
    original!,
  );
  await expect(page.getByRole("tab")).toContainText("Promoted DUT");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
