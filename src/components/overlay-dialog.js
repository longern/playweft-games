import "./overlay-dialog.css";

function syncPageLock() {
  document.body.classList.toggle(
    "has-overlay-dialog",
    Boolean(document.querySelector("dialog.overlay-dialog[open]")),
  );
}

function resolveTarget(target, fallback) {
  return (typeof target === "function" ? target() : target) ?? fallback;
}

export function createOverlayDialog({
  root,
  surface,
  closeButtons = [],
  dismissible = true,
  initialFocus,
  returnFocus,
  beforeOpen,
  beforeClose,
}) {
  let focusFrame;

  function finishClose() {
    window.cancelAnimationFrame(focusFrame);
    delete root.dataset.state;
    syncPageLock();
    resolveTarget(returnFocus)?.focus({ preventScroll: true });
  }

  function finishMotionClose(event) {
    if (
      event.target === surface &&
      root.open &&
      root.dataset.state === "closing"
    ) {
      root.close();
    }
  }

  function setOpen(open) {
    if (open) {
      if (root.open && root.dataset.state !== "closing") return;
      beforeOpen?.();
      root.dataset.state = "open";
      if (!root.open) root.showModal();
      syncPageLock();
      focusFrame = window.requestAnimationFrame(() => {
        resolveTarget(initialFocus, surface)?.focus({ preventScroll: true });
      });
      return;
    }

    if (!root.open || root.dataset.state === "closing") return;
    window.cancelAnimationFrame(focusFrame);
    beforeClose?.();
    root.dataset.state = "closing";
  }

  root.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (dismissible) setOpen(false);
  });
  root.addEventListener("close", finishClose);
  surface.addEventListener("transitionend", finishMotionClose);
  root.addEventListener("click", (event) => {
    if (dismissible && event.target === root) setOpen(false);
  });
  for (const button of closeButtons) {
    button.addEventListener("click", () => setOpen(false));
  }

  return {
    get isOpen() {
      return root.open && root.dataset.state !== "closing";
    },
    setOpen,
  };
}
