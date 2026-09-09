import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const BUILD_VERSION_META_NAME = "playweft-build-version";

export function emitBuildVersion() {
  let buildVersion;
  return {
    name: "emit-build-version",
    generateBundle(_options, bundle) {
      buildVersion = hashBundle(bundle);
      this.emitFile({
        type: "asset",
        fileName: "build-version.json",
        source: `${JSON.stringify({ version: buildVersion })}\n`,
      });
    },
    async writeBundle(options) {
      if (!buildVersion || !options.dir) return;
      const htmlFiles = await findHtmlFiles(resolve(options.dir));
      await Promise.all(
        htmlFiles.map(async (file) => {
          const source = await readFile(file, "utf8");
          await writeFile(file, addBuildVersionMeta(source, buildVersion));
        }),
      );
    },
  };
}

async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return findHtmlFiles(path);
      return entry.name.endsWith(".html") ? [path] : [];
    }),
  );
  return files.flat();
}

export function hashBundle(bundle) {
  const hash = createHash("sha256");
  const outputs = Object.entries(bundle).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [fileName, output] of outputs) {
    if (fileName === "build-version.json" || fileName === "sw.js") continue;
    hash.update(fileName);
    hash.update("\0");
    hash.update(output.type === "chunk" ? output.code : output.source);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export function addBuildVersionMeta(source, version) {
  const headStart = source.indexOf("<head");
  const headEnd = headStart < 0 ? -1 : source.indexOf(">", headStart);
  if (headEnd < 0) {
    throw new Error("Cannot add a build version to HTML without a head");
  }
  const meta = `\n  <meta name="${BUILD_VERSION_META_NAME}" content="${version}" />`;
  return `${source.slice(0, headEnd + 1)}${meta}${source.slice(headEnd + 1)}`;
}
