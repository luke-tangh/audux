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

  test("sidebar and player remain usable at common zoom levels", async ({
    page
  }) => {
    await page.goto("/");
    await stabilize(page);

    await expect(page.getByText("本地优先", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "缺少描述" })).toHaveCount(0);

    const sidebar = page.locator(".sidebar");
    const sidebarScroller = page.locator(".sidebar-scroll-content");
    const scrollingLayers = await sidebar.evaluate((root) =>
      [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
        .filter((element) => {
          const overflowY = getComputedStyle(element).overflowY;
          return overflowY === "auto" || overflowY === "scroll";
        })
        .map((element) => (element === root ? "sidebar" : element.className))
    );
    expect(scrollingLayers).toEqual(["sidebar-scroll-content"]);
    await expect(sidebarScroller).toHaveCSS("scrollbar-gutter", /stable/);

    const scrollbarBounds = await sidebarScroller.evaluate((scroller) => {
      const scrollerRect = scroller.getBoundingClientRect();
      const sidebarRect = scroller.parentElement!.getBoundingClientRect();
      return {
        insetTop: scrollerRect.top - sidebarRect.top,
        insetBottom: sidebarRect.bottom - scrollerRect.bottom
      };
    });
    expect(scrollbarBounds.insetTop).toBeGreaterThanOrEqual(8);
    expect(scrollbarBounds.insetBottom).toBeGreaterThanOrEqual(8);

    const settingsCenter = page.getByRole("button", { name: "设置中心" });
    const player = page.locator(".player-dock");
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
        const sidebar = button.closest<HTMLElement>(".sidebar");
        const selectedOption =
          sidebar?.querySelector<HTMLElement>(".nav-card.active");
        const sidebarRect = sidebar?.getBoundingClientRect();
        const selectedRect = selectedOption?.getBoundingClientRect();
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
            hitTarget === button || (hitTarget ? button.contains(hitTarget) : false),
          selectedOptionClearsScrollbar:
            Boolean(sidebarRect) &&
            Boolean(selectedRect) &&
            selectedRect!.right <= sidebarRect!.right - 8
        };
      });

      expect(
        state,
        `viewport ${viewport.width}x${viewport.height}`
      ).toEqual({
        rendered: true,
        fullyVisible: true,
        receivesPointer: true,
        selectedOptionClearsScrollbar: true
      });

      const playerBounds = await player.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          rendered: rect.width > 0 && rect.height > 0,
          fullyVisible:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= window.innerWidth &&
            rect.bottom <= window.innerHeight
        };
      });
      expect(
        playerBounds,
        `player at viewport ${viewport.width}x${viewport.height}`
      ).toEqual({
        rendered: true,
        fullyVisible: true
      });
    }
  });
});
