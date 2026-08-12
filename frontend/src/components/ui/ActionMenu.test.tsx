import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ActionMenu from "./ActionMenu";

describe("ActionMenu", () => {
  it("supports keyboard navigation, selection and focus restoration", async () => {
    const onSelect = vi.fn();
    render(
      <ActionMenu
        label="处理项目"
        buttonText="处理"
        items={[
          { id: "first", label: "第一个动作", onSelect: vi.fn() },
          { id: "second", label: "第二个动作", onSelect }
        ]}
      />
    );

    const trigger = screen.getByRole("button", { name: "处理项目" });
    fireEvent.click(trigger);
    const first = screen.getByRole("menuitem", { name: "第一个动作" });
    const second = screen.getByRole("menuitem", { name: "第二个动作" });
    await waitFor(() => expect(first).toHaveFocus());

    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(second).toHaveFocus());
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
