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

  test("sidebar settings center remains reachable at common zoom levels", async ({
    page
  }) => {
    await page.goto("/");
    await stabilize(page);

    const settingsCenter = page.getByRole("button", { name: "设置中心" });
    const zoomViewports = [
      { width: 1280, height: 800 },
      { width: 1164, height: 727 },
      { width: 1024, height: 640 },
      { width: 853, height: 533 }
    ];

    for (const viewport of zoomViewports) {
      await page.setViewportSize(viewport);

      const state = await settingsCenter.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );

        return {
          rendered: rect.width > 0 && rect.height > 0,
          fullyVisible:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= window.innerWidth &&
            rect.bottom <= window.innerHeight,
          receivesPointer:
            hitTarget === button || (hitTarget ? button.contains(hitTarget) : false)
        };
      });

      expect(
        state,
        `viewport ${viewport.width}x${viewport.height}`
      ).toEqual({
        rendered: true,
        fullyVisible: true,
        receivesPointer: true
      });
    }
  });
});
