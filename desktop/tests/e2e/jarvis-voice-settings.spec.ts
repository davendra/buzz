import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/jarvis-voice-settings";

test.describe("JARVIS voice settings", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("provider picker renders in Settings", async ({ page }) => {
    await installMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByTestId("open-settings").click();
    await page.getByTestId("profile-popover-settings").click();
    await expect(page.getByTestId("settings-view")).toBeVisible();

    await page.getByTestId("settings-nav-jarvis-voice").click();
    const panel = page.getByTestId("settings-jarvis-voice");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Every provider is offered, and the local one is the default.
    await expect(panel.getByText("Built-in voice (recommended)")).toBeVisible();
    await expect(panel.getByText("Google Chirp 3: HD")).toBeVisible();
    await expect(panel.getByText("System voice")).toBeVisible();

    await waitForAnimations(page);
    await panel.screenshot({ path: `${SHOTS}/01-provider-picker.png` });
  });

  test("selecting Google surfaces the key + privacy guidance", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByTestId("open-settings").click();
    await page.getByTestId("profile-popover-settings").click();
    await page.getByTestId("settings-nav-jarvis-voice").click();

    const panel = page.getByTestId("settings-jarvis-voice");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await panel.getByRole("radio").nth(1).check();

    // Cloud voice must state where the data goes — these agents speak client
    // names and financial figures.
    await expect(panel.getByText(/answers are sent to Google/)).toBeVisible();

    await waitForAnimations(page);
    await panel.screenshot({ path: `${SHOTS}/02-google-selected.png` });
  });
});
