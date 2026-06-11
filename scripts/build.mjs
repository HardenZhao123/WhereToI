import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const assetVersion = normaliseAssetVersion(process.env.RENDER_GIT_COMMIT ?? process.env.GITHUB_SHA ?? Date.now());

function normaliseAssetVersion(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || String(Date.now());
}

function withVersion(specifier) {
  return `${specifier.split("?")[0]}?v=${assetVersion}`;
}

async function rewriteFile(filePath, replacers) {
  let content = await readFile(filePath, "utf8");
  for (const [pattern, replacement] of replacers) {
    content = content.replace(pattern, replacement);
  }
  await writeFile(filePath, content, "utf8");
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : fullPath;
    })
  );
  return files.flat();
}

async function versionStaticAppReferences() {
  await rewriteFile(resolve(dist, "index.html"), [
    [
      /(href=["']\.\/src\/styles\.css)(?:\?[^"']*)?(["'])/g,
      (_, prefix, suffix) => `${prefix}?v=${assetVersion}${suffix}`
    ],
    [
      /(src=["']\.\/src\/main\.js)(?:\?[^"']*)?(["'])/g,
      (_, prefix, suffix) => `${prefix}?v=${assetVersion}${suffix}`
    ]
  ]);

  const jsFiles = (await listFiles(resolve(dist, "src"))).filter((file) => file.endsWith(".js"));
  await Promise.all(
    jsFiles.map((file) =>
      rewriteFile(file, [
        [
          /(from\s+["'])(\.{1,2}\/[^"']+\.js)(?:\?[^"']*)?(["'])/g,
          (_, prefix, specifier, suffix) => `${prefix}${withVersion(specifier)}${suffix}`
        ],
        [
          /(import\s+["'])(\.{1,2}\/[^"']+\.js)(?:\?[^"']*)?(["'])/g,
          (_, prefix, specifier, suffix) => `${prefix}${withVersion(specifier)}${suffix}`
        ],
        [
          /(import\s*\(\s*["'])(\.{1,2}\/[^"']+\.js)(?:\?[^"']*)?(["']\s*\))/g,
          (_, prefix, specifier, suffix) => `${prefix}${withVersion(specifier)}${suffix}`
        ]
      ])
    )
  );

  const cssFiles = (await listFiles(resolve(dist, "src"))).filter((file) => file.endsWith(".css"));
  await Promise.all(
    cssFiles.map((file) =>
      rewriteFile(file, [
        [
          /(@import\s+(?:url\(\s*)?["'])(\.{1,2}\/[^"')]+\.css)(?:\?[^"')]+)?(["']\s*\)?[^;]*;)/g,
          (_, prefix, specifier, suffix) => `${prefix}${withVersion(specifier)}${suffix}`
        ]
      ])
    )
  );
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, "index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "src"), resolve(dist, "src"), { recursive: true });
await rm(resolve(dist, "src", "data", "toilets.csv"), { force: true });
await versionStaticAppReferences();

const toiletLevelsSource = resolve(root, "toilet_levels");
const toiletLevelsDist = resolve(dist, "toilet_levels");
await mkdir(toiletLevelsDist, { recursive: true });
const toiletLevelImages = await readdir(toiletLevelsSource, { withFileTypes: true });
await Promise.all(
  toiletLevelImages
    .filter((entry) => entry.isFile() && entry.name.endsWith("_small.jpg"))
    .map((entry) =>
      cp(resolve(toiletLevelsSource, entry.name), resolve(toiletLevelsDist, entry.name))
    )
);

console.log("Built static app to dist/");
