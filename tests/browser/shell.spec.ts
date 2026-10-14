import { test, expect } from "@playwright/test";
test("secure login, both compatibility themes, SSH trust and terminal I/O", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("browser-admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Application theme").selectOption("classic-light");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "classic-light",
  );
  await page.screenshot({
    path: testInfo.outputPath("classic-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "classic-dark",
  );
  await page.screenshot({
    path: testInfo.outputPath("classic-dark.png"),
    fullPage: true,
  });
  await page.getByLabel("Quick Connect").fill("lab@127.0.0.1:22222");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Verify SSH host key" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept key" }).click();
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Authenticate", exact: true }).click();
  await expect(page.locator(".pane-header")).toContainText("OPEN");
  await page.locator(".xterm-helper-textarea").fill("");
  await page
    .locator(".xterm-helper-textarea")
    .pressSequentially("printf __BROWSER_OK__");
  await page.locator(".xterm-helper-textarea").press("Enter");
  await expect(page.locator(".xterm-screen")).toContainText("__BROWSER_OK__");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "classic-light",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("saved profiles, encrypted credential opt-in, independent preferences and reconnect", async ({
  page,
}, testInfo) => {
  const name = `fixture-${testInfo.project.name}-${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Username").fill("browser-admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await page
    .getByRole("button", { name: "Saved credentials", exact: true })
    .click();
  await page.getByLabel("Credential name").fill(name);
  await page.getByLabel("Saved password").fill("fixture-password");
  await expect(
    page.getByRole("button", { name: "Save credential", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Save this secret encrypted on the server").check();
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click();
  await expect(page.locator(".record-list")).toContainText(name);
  await expect(page.getByLabel("Saved password")).toHaveValue("");
  await page
    .getByRole("button", { name: "Close Saved credentials", exact: true })
    .click();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.getByLabel("Profile name").fill(name);
  await page.getByLabel("Host", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("Port", { exact: true }).fill("22222");
  await page.getByLabel("SSH username").fill("lab");
  await page
    .getByRole("combobox", { name: "Saved credential", exact: true })
    .selectOption({ label: `${name} (password)` });
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.locator(".profile-row").filter({ hasText: name }),
  ).toContainText(name);
  await page
    .getByRole("button", { name: `Edit profile ${name}`, exact: true })
    .click();
  await page.getByLabel("Profile name").fill(`${name}-edited`);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Application theme").selectOption("classic-dark");
  await page.getByLabel("Terminal palette").selectOption("solarized-dark");
  await page.getByLabel("Terminal font size").fill("15");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "classic-dark",
  );
  await page.reload();
  await expect(page.getByRole("contentinfo")).toContainText(
    "Browser connected",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "classic-dark",
  );
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.getByLabel("Terminal palette")).toHaveValue(
    "solarized-dark",
  );
  await expect(page.getByLabel("Terminal font size")).toHaveValue("15");
  await page
    .getByRole("button", { name: "Close Workspace preferences", exact: true })
    .click();
  await page
    .locator(".profile-row")
    .getByRole("button", { name: `${name}-edited`, exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Verify SSH host key" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept key", exact: true }).click();
  await expect(page.locator(".pane-header")).toContainText("OPEN");
  await expect(
    page.getByRole("dialog", { name: "SSH authentication" }),
  ).toHaveCount(0);
  await page
    .locator(".xterm-helper-textarea")
    .pressSequentially("printf __SAVED_PROFILE_OK__");
  await page.locator(".xterm-helper-textarea").press("Enter");
  await expect(page.locator(".xterm-screen")).toContainText(
    "__SAVED_PROFILE_OK__",
  );
  await page.getByLabel("Search terminal").fill("__SAVED_PROFILE_OK__");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("No match", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Verify SSH host key" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept key", exact: true }).click();
  await expect(page.locator(".pane-header")).toContainText("OPEN");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator(".pane-header")).toContainText("CLOSED");
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: `Delete profile ${name}-edited`, exact: true })
    .click();
  await expect(
    page.locator(".profile-row").getByText(`${name}-edited`, { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Saved credentials", exact: true })
    .click();
  await page
    .locator(".record-list > div")
    .filter({ hasText: name })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.locator(".record-list > div").filter({ hasText: name }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close Saved credentials", exact: true })
    .click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Application theme").selectOption("classic-light");
  await page.getByLabel("Terminal palette").selectOption("classic");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
});
