import { resolve } from "node:path";
import { createAppServer } from "../server/app-server.mjs";

const root = resolve(".");
const port = Number(process.env.PORT ?? 4173);

const appServer = await createAppServer({ rootDirectory: root, port });
await appServer.listen();

console.log(`WHERE ZZZ app server running at http://localhost:${port}`);
console.log("API endpoints: /api/toilets, /api/account, /api/access-history");
