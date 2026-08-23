import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const unexpectedErrors: string[] = [];

    page.on("pageerror", (error) => {
      unexpectedErrors.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      const text = message.text();
      const isExpectedConflictResponse =
        text === "Failed to load resource: the server responded with a status of 409 (Conflict)";

      if (message.type() === "error" && !isExpectedConflictResponse) {
        unexpectedErrors.push(`console.error: ${text}`);
      }
    });

    await use(page);

    expect(
      unexpectedErrors,
      "The page emitted unexpected runtime errors during the visual test"
    ).toEqual([]);
  }
});

export { expect };
