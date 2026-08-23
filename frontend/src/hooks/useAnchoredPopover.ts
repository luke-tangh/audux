import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type AnchoredPopoverOptions = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  onReposition: () => void;
};

/** Shared viewport and outside-pointer behavior for portalled anchored popovers. */
export function useAnchoredPopover({
  open,
  anchorRef,
  popoverRef,
  onDismiss,
  onReposition
}: AnchoredPopoverOptions) {
  const dismissRef = useRef(onDismiss);
  const repositionRef = useRef(onReposition);
  dismissRef.current = onDismiss;
  repositionRef.current = onReposition;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      dismissRef.current();
    }

    const reposition = () => repositionRef.current();
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchorRef, open, popoverRef]);
}
