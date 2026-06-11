import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, process.env.WHERETOI_BUILD_DIR ?? "dist");
const assetVersion = normaliseAssetVersion(process.env.RENDER_GIT_COMMIT ?? process.env.GITHUB_SHA ?? Date.now());
const VERSIONED_STATIC_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".mp4",
  ".png",
  ".svg",
  ".webm",
  ".webp",
  ".woff",
  ".woff2"
]);

function normaliseAssetVersion(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || String(Date.now());
}

function withVersion(specifier) {
  const [withoutFragment, fragment = ""] = specifier.split("#", 2);
  const path = withoutFragment.split("?")[0];
  return `${path}?v=${assetVersion}${fragment ? `#${fragment}` : ""}`;
}

function isLocalStaticReference(specifier) {
  const value = String(specifier ?? "").trim();
  if (!value || value.startsWith("#") || value.startsWith("//")) return false;
  if (/^(?:data|blob|mailto|tel):/i.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;

  const path = value.split(/[?#]/, 1)[0].toLowerCase();
  const extension = [...VERSIONED_STATIC_EXTENSIONS].find((item) => path.endsWith(item));
  return Boolean(extension);
}

function versionLocalStaticReference(specifier) {
  return isLocalStaticReference(specifier) ? withVersion(specifier) : specifier;
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
  const htmlReferenceReplacers = [
    [
      /((?:src|href|poster|data-html-include)=["'])([^"']+)(["'])/g,
      (_, prefix, specifier, suffix) => `${prefix}${versionLocalStaticReference(specifier)}${suffix}`
    ],
    [
      /(srcset=["'])([^"']+)(["'])/g,
      (_, prefix, value, suffix) => {
        const versionedValue = value
          .split(",")
          .map((candidate) => {
            const [specifier, ...descriptor] = candidate.trim().split(/\s+/);
            return [versionLocalStaticReference(specifier), ...descriptor].join(" ");
          })
          .join(", ");
        return `${prefix}${versionedValue}${suffix}`;
      }
    ]
  ];

  await rewriteFile(resolve(dist, "index.html"), htmlReferenceReplacers);

  const jsFiles = (await listFiles(resolve(dist, "src"))).filter((file) => file.endsWith(".js"));
  await Promise.all(
    jsFiles.map((file) =>
      rewriteFile(file, [
        [
          /(\bassetVersion:\s*["'])([^"']*)(["'])/g,
          (_, prefix, _version, suffix) => `${prefix}${assetVersion}${suffix}`
        ],
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
        ],
        [
          /(["'`])((?:\.{0,2}\/|[a-zA-Z0-9_-]+\/)[^"'`\s?#]+\.(?:avif|gif|ico|jpe?g|mp4|png|svg|webm|webp|woff2?))(?:\?[^"'`\s#]*)?(["'`])/g,
          (_, prefix, specifier, suffix) => `${prefix}${withVersion(specifier)}${suffix}`
        ]
      ])
    )
  );

  const htmlFiles = (await listFiles(resolve(dist, "src"))).filter((file) => file.endsWith(".html"));
  await Promise.all(
    htmlFiles.map((file) => rewriteFile(file, htmlReferenceReplacers))
  );

  const cssFiles = (await listFiles(resolve(dist, "src"))).filter((file) => file.endsWith(".css"));
  await Promise.all(
    cssFiles.map((file) =>
      rewriteFile(file, [
        [
          /(@import\s+(?:url\(\s*)?["'])(\.{1,2}\/[^"')]+\.css)(?:\?[^"')]+)?(["']\s*\)?[^;]*;)/g,
          (_, prefix, specifier, suffix) => `${prefix}${withVersion(specifier)}${suffix}`
        ],
        [
          /(url\(\s*["']?)([^"')]+)(["']?\s*\))/g,
          (_, prefix, specifier, suffix) => `${prefix}${versionLocalStaticReference(specifier)}${suffix}`
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
