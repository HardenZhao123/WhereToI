import { resolve } from "node:path";
import { createAppServer } from "../server/app-server.mjs";

const appRoot = resolve(".");
const staticRoot = resolve(process.env.WHERETOI_STATIC_ROOT ?? (process.env.NODE_ENV === "production" ? "dist" : "."));
const port = Number(process.env.PORT ?? 4173);

const appServer = await createAppServer({
  rootDirectory: staticRoot,
  port,
  databaseOptions: {
    rootDirectory: appRoot
  }
});
await appServer.listen();

console.log(`WhereToI app server running at http://localhost:${port}`);
console.log(`Static root: ${staticRoot}`);
console.log("API endpoints: /api/toilets, /api/account, /api/access-history");
