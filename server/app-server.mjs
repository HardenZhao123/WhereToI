import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createDatabase } from "./database.mjs";

const STATIC_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml"
};

const TRUTHY_QUERY_FLAGS = new Set(["1", "true", "yes"]);
const BODY_SIZE_LIMIT_BYTES = 1024 * 1024;
const CLIENT_ERROR_MESSAGE_MATCHERS = [
  "required",
  "non-negative",
  "yes or no",
  "scoringModel",
  "Unsupported",
  "not found"
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendPlainText(response, statusCode, message) {
  response.writeHead(statusCode);
  response.end(message);
}

async function readJsonBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > BODY_SIZE_LIMIT_BYTES) {
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

function isRequestBodyError(error) {
  return error instanceof Error && error.message.includes("Request body");
}

function isKnownClientError(error) {
  return (
    error instanceof Error &&
    CLIENT_ERROR_MESSAGE_MATCHERS.some((matcher) => error.message.includes(matcher))
  );
}

function normaliseOptionalToiletId(toiletId) {
  if (typeof toiletId !== "string") return null;

  const trimmedToiletId = toiletId.trim();
  return trimmedToiletId.length > 0 ? trimmedToiletId : null;
}

function parseAccessibleOnly(queryValue) {
  return TRUTHY_QUERY_FLAGS.has((queryValue ?? "").toLowerCase());
}

function createApiRouteHandlers(database) {
  return {
    "GET /api/health": async ({ response }) => {
      sendJson(response, 200, {
        status: "ok",
        commit: process.env.RENDER_GIT_COMMIT ?? null
      });
    },
    "GET /api/toilets": async ({ response, url }) => {
      const search = url.searchParams.get("search") ?? "";
      const accessibleOnly = parseAccessibleOnly(url.searchParams.get("accessibleOnly"));
      const toilets = await database.getToilets({ search, accessibleOnly });

      sendJson(response, 200, { toilets });
    },
    "GET /api/account": async ({ response }) => {
      const account = await database.getAccount();
      const history = await database.getAccessHistory(10);

      sendJson(response, 200, { account, history });
    },
    "GET /api/access-history": async ({ response, url }) => {
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const history = await database.getAccessHistory(limit);

      sendJson(response, 200, { history });
    },
    "POST /api/access-history": async ({ request, response }) => {
      const body = await readJsonBody(request);
      const result = await database.recordAccess({
        toiletId: normaliseOptionalToiletId(body.toiletId),
        toiletName: body.toiletName,
        eventType: body.eventType,
        amountGbp: body.amountGbp,
        useFreeTicket: Boolean(body.useFreeTicket)
      });

      sendJson(response, 201, result);
    },
    "POST /api/cleanliness-survey": async ({ request, response }) => {
      const body = await readJsonBody(request);
      const result = await database.recordCleanlinessSurvey({
        toiletId: normaliseOptionalToiletId(body.toiletId),
        toiletName: body.toiletName,
        answer: body.answer
      });

      sendJson(response, 201, result);
    }
  };
}

async function handleApiRoute({ routeHandlers, request, response, url }) {
  const routeKey = `${request.method ?? "GET"} ${url.pathname}`;
  const routeHandler = routeHandlers[routeKey];

  if (!routeHandler) {
    return false;
  }

  await routeHandler({ request, response, url });
  return true;
}

function resolveStaticFilePath(root, pathname) {
  const safePathname = normalize(decodeURIComponent(pathname)).replace(/^([.][./\\])+/, "");
  return resolve(join(root, safePathname === "/" ? "index.html" : safePathname));
}

async function serveStaticFile({ root, pathname, response }) {
  const candidate = resolveStaticFilePath(root, pathname);

  if (!candidate.startsWith(root)) {
    sendPlainText(response, 403, "Forbidden");
    return;
  }

  const fileStat = await stat(candidate);
  const file = fileStat.isDirectory() ? join(candidate, "index.html") : candidate;

  response.writeHead(200, {
    "Content-Type": STATIC_CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(file).pipe(response);
}

function createRequestHandler({ root, port, database }) {
  const routeHandlers = createApiRouteHandlers(database);

  return async function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);

    try {
      const apiHandled = await handleApiRoute({ routeHandlers, request, response, url });
      if (apiHandled) return;

      await serveStaticFile({ root, pathname: url.pathname, response });
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendPlainText(response, 404, "Not found");
        return;
      }

      if (isRequestBodyError(error) || isKnownClientError(error)) {
        sendJson(response, 400, { error: error.message });
        return;
      }

      console.error("Server request failed:", error);
      sendJson(response, 500, { error: "Internal server error." });
    }
  };
}

export async function createAppServer({ rootDirectory = ".", port = 4173 } = {}) {
  const root = resolve(rootDirectory);
  const database = await createDatabase({ rootDirectory: root });
  const requestHandler = createRequestHandler({ root, port, database });

  const server = createServer(requestHandler);

  return {
    listen(host = undefined) {
      return new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off("error", onError);
          rejectListen(error);
        };

        server.on("error", onError);

        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const assignedPort = typeof address === "object" && address ? address.port : port;
          resolveListen(assignedPort);
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
      }).then(async () => {
        await database.close?.();
      });
    }
  };
}
