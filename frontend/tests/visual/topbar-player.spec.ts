import { expect, test } from "@playwright/test";
import { mockPlayerBar, PLAYER_AUDIO_ITEMS } from "./player-fixture";

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

async function expectTopbarControlsFit(
  topbar: import("@playwright/test").Locator,
  viewport: string
) {
  const state = await topbar.evaluate((element) => {
    const search = element.querySelector<HTMLElement>(".top-command-search")!;
    const queryRow = element.querySelector<HTMLElement>(".top-query-row")!;
    const toolbar = element.querySelector<HTMLElement>(".top-toolbar-controls")!;
    const filters = element.querySelector<HTMLElement>(".top-filter-controls")!;
    const actions = element.querySelector<HTMLElement>(".top-toolbar-actions")!;
    const status = element.querySelector<HTMLElement>(".top-file-field")!;
    const sort = element.querySelector<HTMLElement>(".top-sort-field")!;
    const searchRect = search.getBoundingClientRect();
    const queryRect = queryRow.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    const sortRect = sort.getBoundingClientRect();

    return {
      searchUsesFullRow: Math.abs(searchRect.width - queryRect.width) <= 1,
      searchIsLongest:
        searchRect.width > statusRect.width && searchRect.width > sortRect.width,
      filtersRemainUsable: statusRect.width >= 150 && sortRect.width >= 170,
      toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth + 1,
      filtersFit: filters.scrollWidth <= filters.clientWidth + 1,
      actionsFit: actions.scrollWidth <= actions.clientWidth + 1
    };
  });

  expect(state, `topbar controls at viewport ${viewport}`).toEqual({
    searchUsesFullRow: true,
    searchIsLongest: true,
    filtersRemainUsable: true,
    toolbarFits: true,
    filtersFit: true,
    actionsFit: true
  });
}

async function expectPlayerUsesCenteredSpace(
  player: import("@playwright/test").Locator,
  viewport: string
) {
  const state = await player.evaluate((element) => {
    const playerRect = element.getBoundingClientRect();
    const playRect = element
      .querySelector<HTMLElement>(".play-toggle")!
      .getBoundingClientRect();
    const progressRect = element
      .querySelector<HTMLElement>('.player-progress input[type="range"]')!
      .getBoundingClientRect();

    return {
      playCenterOffset: Math.abs(
        playRect.left + playRect.width / 2 -
          (playerRect.left + playerRect.width / 2)
      ),
      progressWidthRatio: progressRect.width / playerRect.width
    };
  });

  expect(state.playCenterOffset, `play button at ${viewport}`).toBeLessThanOrEqual(1);
  expect(state.progressWidthRatio, `progress width at ${viewport}`).toBeGreaterThan(0.3);
}

test.describe("MD3 visual regression", () => {
  test("TopBar responsive states", async ({ page }) => {
    await page.goto("/");
    await stabilize(page);

    const topbar = page.locator(".top-command-bar");
    await expect(topbar).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(topbar).toHaveScreenshot("topbar-wide.png");
    await expectTopbarControlsFit(topbar, "1280x800");

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(topbar).toHaveScreenshot("topbar-medium.png");
    await expectTopbarControlsFit(topbar, "1000x800");

    await page.setViewportSize({ width: 760, height: 800 });
    await expect(topbar).toHaveScreenshot("topbar-compact.png");
    await expectTopbarControlsFit(topbar, "760x800");

    await page.setViewportSize({ width: 540, height: 800 });
    const filterToggle = page.getByRole("button", { name: "筛选与排序（0）" });
    await expect(filterToggle).toBeVisible();
    await expect(page.getByRole("combobox", { name: "按音频处理状态筛选" })).toBeHidden();
    await expect(topbar).toHaveScreenshot("topbar-mobile.png");
    await filterToggle.click();
    await expect(page.getByRole("combobox", { name: "按音频处理状态筛选" })).toBeVisible();
    await expectTopbarControlsFit(topbar, "540x800 expanded filters");

    await page.getByRole("combobox", { name: "按音频处理状态筛选" }).click();
    await page.getByRole("option", { name: "转写 · 已完成" }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: "重置" })).toBeVisible();
    await expectTopbarControlsFit(topbar, "1280x800 with reset action");
  });

  test("PlayerBar responsive states", async ({ page }) => {
    await mockPlayerBar(page);
    await page.goto("/");
    await stabilize(page);

    const player = page.locator(".player-dock");
    await expect(player).toHaveClass(/has-audio/);
    await expect(player.locator(".player-now-text strong")).toHaveAttribute(
      "title",
      PLAYER_AUDIO_ITEMS[0].title_user
    );
    await expect(page.getByRole("button", { name: "播放上一条" })).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(player).toHaveScreenshot("player-wide.png");
    await expectPlayerUsesCenteredSpace(player, "1280x800");

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(player).toHaveScreenshot("player-medium.png");
    await expectPlayerUsesCenteredSpace(player, "1000x800");

    await page.setViewportSize({ width: 760, height: 800 });
    await expect(player).toHaveScreenshot("player-compact.png");
    await expectPlayerUsesCenteredSpace(player, "760x800");

    const compactState = await player.evaluate((element) => ({
      fits: element.scrollWidth <= element.clientWidth + 1,
      controls: Array.from(
        element.querySelectorAll<HTMLElement>(
          ".player-controls button, .player-option-trigger, .queue-toggle-button"
        )
      ).map((control) => ({
        width: control.getBoundingClientRect().width,
        height: control.getBoundingClientRect().height
      }))
    }));
    expect(compactState.fits).toBe(true);
    expect(compactState.controls.every(({ width, height }) => width >= 40 && height >= 40))
      .toBe(true);

    await page.setViewportSize({ width: 680, height: 800 });
    const stackedState = await player.evaluate((element) => {
      const nowCard = element.querySelector<HTMLElement>(".player-now-card")!;
      const center = element.querySelector<HTMLElement>(".player-center")!;
      const nowRect = nowCard.getBoundingClientRect();
      const centerRect = center.getBoundingClientRect();

      return {
        fits: element.scrollWidth <= element.clientWidth + 1,
        controlsMoveBelowMetadata: centerRect.top >= nowRect.bottom
      };
    });
    expect(stackedState).toEqual({
      fits: true,
      controlsMoveBelowMetadata: true
    });

    await page.setViewportSize({ width: 1000, height: 800 });
    await page.getByRole("button", { name: "打开播放速度控制" }).click();
    await expect(page.getByRole("dialog", { name: "播放速度" })).toBeVisible();
    await expect(page.locator("#root")).toHaveScreenshot("player-speed-medium.png");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "打开音量控制" }).click();
    await expect(page.getByRole("dialog", { name: "音量" })).toBeVisible();
    await expect(page.locator("#root")).toHaveScreenshot("player-volume-medium.png");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "打开播放队列" }).click();
    await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();
    await expect(page.locator("#root")).toHaveScreenshot("player-queue-medium.png");

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.localStorage.setItem("local-audio-library-theme", "dark");
    });
    await page.reload();
    await stabilize(page);
    await expect(player).toHaveClass(/has-audio/);
    await expect(player).toHaveScreenshot("player-dark.png");
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

      if (viewport.width <= 860) {
        const openNavigation = page.getByRole("button", { name: "打开导航" });
        await expect(openNavigation).toBeVisible();
        await openNavigation.click();
        await expect(page.locator(".sidebar-drawer-close")).toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "打开导航" })).toBeHidden();
      }

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

      if (viewport.width <= 860) {
        await page.locator(".sidebar-drawer-close").click();
        await expect(page.locator(".sidebar")).toHaveAttribute("aria-hidden", "true");
      }
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addStyleTag({
      content: ".player-now-card { min-height: 80px !important; }"
    });

    const linuxFontMetricsState = await player.evaluate((element) => {
      const playerRect = element.getBoundingClientRect();
      const nowCardRect = element
        .querySelector<HTMLElement>(".player-now-card")!
        .getBoundingClientRect();

      return {
        expandsPastDefaultHeight: playerRect.height > 96,
        contentContained: nowCardRect.bottom <= playerRect.bottom,
        fullyVisible: playerRect.bottom <= window.innerHeight
      };
    });
    expect(linuxFontMetricsState).toEqual({
      expandsPastDefaultHeight: false,
      contentContained: true,
      fullyVisible: true
    });
  });
});
