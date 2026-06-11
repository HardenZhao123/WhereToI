import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testVersion = "0123456789abcdef0123456789abcdef01234567";
const versionQuery = `?v=${testVersion}`;
const staticExtensions = new Set([
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

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : fullPath;
    })
  );
  return nested.flat();
}

function isLocalStaticReference(specifier) {
  const value = String(specifier ?? "").trim();
  if (!value || value.startsWith("#") || value.startsWith("//")) return false;
  if (/^(?:data|blob|mailto|tel):/i.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;

  const path = value.split(/[?#]/, 1)[0].toLowerCase();
  return [...staticExtensions].some((extension) => path.endsWith(extension));
}

function collectHtmlReferences(content) {
  const references = [];
  for (const match of content.matchAll(/(?:src|href|poster|data-html-include)=["']([^"']+)["']/g)) {
    references.push(match[1]);
  }
  for (const match of content.matchAll(/srcset=["']([^"']+)["']/g)) {
    references.push(...match[1].split(",").map((candidate) => candidate.trim().split(/\s+/, 1)[0]));
  }
  return references;
}

test("production build versions the complete local static asset graph", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "wheretoi-build-output-"));

  try {
    await execFileAsync(process.execPath, ["scripts/build.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        GITHUB_SHA: testVersion,
        WHERETOI_BUILD_DIR: outputDirectory
      }
    });

    const files = await listFiles(outputDirectory);
    const htmlFiles = files.filter((file) => file.endsWith(".html"));
    const jsFiles = files.filter((file) => file.endsWith(".js"));
    const cssFiles = files.filter((file) => file.endsWith(".css"));

    for (const file of htmlFiles) {
      const content = await readFile(file, "utf8");
      const unversioned = collectHtmlReferences(content).filter(
        (specifier) => isLocalStaticReference(specifier) && !specifier.includes(versionQuery)
      );
      assert.deepEqual(unversioned, [], `${relative(outputDirectory, file)} has unversioned local references`);
    }

    for (const file of jsFiles) {
      const content = await readFile(file, "utf8");
      const localImports = [...content.matchAll(/(?:from\s+|import\s*\(?\s*)["'](\.{1,2}\/[^"']+\.js[^"']*)["']/g)]
        .map((match) => match[1]);
      const localStaticStrings = [...content.matchAll(/["'`]((?:\.{0,2}\/|[a-zA-Z0-9_-]+\/)[^"'`\s?#]+\.(?:avif|gif|ico|jpe?g|mp4|png|svg|webm|webp|woff2?)(?:\?[^"'`\s#]*)?)["'`]/g)]
        .map((match) => match[1]);
      const unversioned = [...localImports, ...localStaticStrings].filter(
        (specifier) => !specifier.includes(versionQuery)
      );
      assert.deepEqual(unversioned, [], `${relative(outputDirectory, file)} has unversioned JS dependencies/assets`);
    }

    for (const file of cssFiles) {
      const content = await readFile(file, "utf8");
      const imports = [...content.matchAll(/@import\s+(?:url\(\s*)?["']([^"')]+)["']/g)].map((match) => match[1]);
      const urls = [...content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]);
      const unversioned = [...imports, ...urls].filter(
        (specifier) => isLocalStaticReference(specifier) && !specifier.includes(versionQuery)
      );
      assert.deepEqual(unversioned, [], `${relative(outputDirectory, file)} has unversioned CSS dependencies/assets`);
    }

    const indexHtml = await readFile(join(outputDirectory, "index.html"), "utf8");
    assert.match(indexHtml, new RegExp(`src/logo\\.png\\?v=${testVersion}`));
    assert.match(indexHtml, new RegExp(`src/main\\.js\\?v=${testVersion}`));
    assert.match(indexHtml, new RegExp(`src/styles\\.css\\?v=${testVersion}`));

    const appConfig = await readFile(join(outputDirectory, "src", "app", "config", "app-config.js"), "utf8");
    assert.match(appConfig, new RegExp(`assetVersion: ["']${testVersion}["']`));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
