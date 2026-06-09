import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, "index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "src"), resolve(dist, "src"), { recursive: true });
await rm(resolve(dist, "src", "data", "toilets.csv"), { force: true });

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
