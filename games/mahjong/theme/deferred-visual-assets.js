export function afterWindowLoad({ document, window, callback }) {
  const schedule = () => window.setTimeout(callback, 0);
  if (document.readyState === "complete") {
    schedule();
    return;
  }
  window.addEventListener("load", schedule, { once: true });
}

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

export function deferMahjongImageAssets({ document, window, urls }) {
  const apply = () => {
    for (const image of document.querySelectorAll("img[data-deferred-image]")) {
      const url = urls[image.dataset.deferredImage];
      if (!url) continue;
      image.src = url;
      image.removeAttribute("data-deferred-image");
    }
  };
  const schedule = () => window.setTimeout(apply, 0);
  if (document.readyState === "complete") {
    schedule();
    return;
  }
  window.addEventListener("load", schedule, { once: true });
}
