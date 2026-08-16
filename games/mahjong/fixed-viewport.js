export const MAHJONG_VIEWPORT = Object.freeze({
  width: 1280,
  height: 720,
  aspect: 16 / 9,
});

export function fixedViewportScale(width, height) {
  const availableWidth = Math.max(1, Number(width) || 1);
  const availableHeight = Math.max(1, Number(height) || 1);
  return Math.min(
    availableWidth / MAHJONG_VIEWPORT.width,
    availableHeight / MAHJONG_VIEWPORT.height,
  );
}

export function bindFixedViewport(frame, container = frame?.parentElement) {
  if (!frame || !container) throw new TypeError("Mahjong fixed viewport requires a frame and container");

  const resize = () => {
    const bounds = container.getBoundingClientRect();
    frame.style.setProperty(
      "--mahjong-viewport-scale",
      String(fixedViewportScale(bounds.width, bounds.height)),
    );
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  return () => observer.disconnect();
}
