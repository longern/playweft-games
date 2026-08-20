export function deferMahjongDecorativeAssets({
  document,
  window,
  urls,
}) {
  const apply = () => {
    const root = document.documentElement;
    for (const [name, url] of Object.entries(urls)) {
      root.style.setProperty(name, `url(${JSON.stringify(url)})`);
    }
    root.dataset.mahjongDecorativeAssets = "ready";
  };
  const schedule = () => window.setTimeout(apply, 0);
  if (document.readyState === "complete") {
    schedule();
    return;
  }
  window.addEventListener("load", schedule, { once: true });
}
