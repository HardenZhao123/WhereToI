import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createDatabase } from "./database.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
  }

  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

export async function createAppServer({ rootDirectory = ".", port = 4173 } = {}) {
  const root = resolve(rootDirectory);
  const database = await createDatabase({ rootDirectory: root });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (url.pathname === "/api/toilets" && request.method === "GET") {
        const search = url.searchParams.get("search") ?? "";
        const accessibleOnly = ["1", "true", "yes"].includes(
          (url.searchParams.get("accessibleOnly") ?? "").toLowerCase()
        );

        const toilets = database.getToilets({ search, accessibleOnly });
        sendJson(response, 200, { toilets });
        return;
      }

      if (url.pathname === "/api/account" && request.method === "GET") {
        sendJson(response, 200, {
          account: database.getAccount(),
          history: database.getAccessHistory(10)
        });
        return;
      }

      if (url.pathname === "/api/access-history" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? 10);
        sendJson(response, 200, { history: database.getAccessHistory(limit) });
        return;
      }

      if (url.pathname === "/api/access-history" && request.method === "POST") {
        const body = await readJsonBody(request);

        const result = database.recordAccess({
          toiletId: typeof body.toiletId === "string" && body.toiletId.trim().length > 0 ? body.toiletId.trim() : null,
          toiletName: body.toiletName,
          eventType: body.eventType,
          amountGbp: body.amountGbp,
          useFreeTicket: Boolean(body.useFreeTicket)
        });

        sendJson(response, 201, result);
        return;
      }

      const pathname = normalize(decodeURIComponent(url.pathname)).replace(/^([.][./\\])+/, "");
      const candidate = resolve(join(root, pathname === "/" ? "index.html" : pathname));

      if (!candidate.startsWith(root)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const fileStat = await stat(candidate);
      const file = fileStat.isDirectory() ? join(candidate, "index.html") : candidate;

      response.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream"
      });
      createReadStream(file).pipe(response);
    } catch (error) {
      if (error?.code === "ENOENT") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      if (error instanceof Error && error.message.includes("Request body")) {
        sendJson(response, 400, { error: error.message });
        return;
      }

      if (error instanceof Error && (error.message.includes("required") || error.message.includes("non-negative"))) {
        sendJson(response, 400, { error: error.message });
        return;
      }

      console.error("Server request failed:", error);
      sendJson(response, 500, { error: "Internal server error." });
    }
  });

  return {
    listen() {
      return new Promise((resolveListen) => {
        server.listen(port, () => {
          resolveListen();
        });
      });
    },
    close() {
      return new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  };
}
