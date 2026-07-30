import { expect, test } from "@playwright/test";

async function stabilize(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }

      .toast-stack {
        display: none !important;
      }
    `
  });
}

test.describe("MD3 visual regression", () => {
  test("TopBar responsive states", async ({ page }) => {
    await page.goto("/");
    await stabilize(page);

    const topbar = page.locator(".top-command-bar");
    await expect(topbar).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(topbar).toHaveScreenshot("topbar-wide.png");

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(topbar).toHaveScreenshot("topbar-medium.png");

    await page.setViewportSize({ width: 760, height: 800 });
    await expect(topbar).toHaveScreenshot("topbar-compact.png");
  });

  test("PlayerBar responsive states", async ({ page }) => {
    await page.goto("/");
    await stabilize(page);

    const player = page.locator(".player-dock");
    await expect(player).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(player).toHaveScreenshot("player-wide.png");

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(player).toHaveScreenshot("player-medium.png");

    await page.setViewportSize({ width: 760, height: 800 });
    await expect(player).toHaveScreenshot("player-compact.png");
  });
});
