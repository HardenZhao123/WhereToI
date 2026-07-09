import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_COLD_TIMEOUT_MS = 180_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 180_000;
const DEFAULT_PERSON_MODEL = "yolo26n-seg.pt";
const RUNNER_PATH = fileURLToPath(new URL("../../scripts/yolo_person_runner.py", import.meta.url));

function getImageExtension(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

export function parseYoloPersonJsonOutput(output) {
  const text = String(output || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Ultralytics/torch can write setup output before our JSON payload.
  }

  for (let index = text.lastIndexOf("{"); index >= 0; index = text.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Keep looking for the start of the final JSON object.
    }
  }
  return null;
}

function normalisePersonBox(box) {
  const normalized = box?.box ?? {};
  const confidence = Number(box?.confidence);
  const safeNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  };

  return {
    label: "person",
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    box: {
      x: safeNumber(normalized.x),
      y: safeNumber(normalized.y),
      width: safeNumber(normalized.width),
      height: safeNumber(normalized.height)
    },
    pixels: box?.pixels && typeof box.pixels === "object" ? {
      x1: Number.isFinite(Number(box.pixels.x1)) ? Number(box.pixels.x1) : null,
      y1: Number.isFinite(Number(box.pixels.y1)) ? Number(box.pixels.y1) : null,
      x2: Number.isFinite(Number(box.pixels.x2)) ? Number(box.pixels.x2) : null,
      y2: Number.isFinite(Number(box.pixels.y2)) ? Number(box.pixels.y2) : null
    } : null
  };
}

export function createPersonDetectionEvidence({
  provider = "yolo",
  model = null,
  status = "completed",
  boxes = [],
  image = null,
  blurredImage = null,
  blurred = false,
  blurError = "",
  error = "",
  checkedAt = new Date().toISOString()
} = {}) {
  const safeBoxes = Array.isArray(boxes)
    ? boxes.map(normalisePersonBox).filter((box) => box.box.width > 0 && box.box.height > 0).slice(0, 40)
    : [];

  return {
    status: status === "completed" && safeBoxes.length === 0 ? "no_person" : String(status || "completed"),
    provider,
    model: model ? String(model).slice(0, 120) : null,
    boxes: safeBoxes,
    image: image && typeof image === "object" ? {
      width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
      height: Number.isFinite(Number(image.height)) ? Number(image.height) : null
    } : null,
    blurredImage: blurredImage?.dataUrl ? {
      dataUrl: String(blurredImage.dataUrl),
      mimeType: String(blurredImage.mimeType || "image/jpeg"),
      size: Number.isFinite(Number(blurredImage.size)) ? Number(blurredImage.size) : null
    } : null,
    blurred: Boolean(blurred),
    blurError: String(blurError || "").slice(0, 600),
    error: String(error || "").slice(0, 600),
    checkedAt
  };
}

function cleanYoloPersonProcessError(error, stderr) {
  const rawText = String(stderr || error?.message || "YOLO worker stopped before returning a result.");
  const usefulText = rawText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Command failed:"))
    .join(" ")
    .trim();

  return usefulText || "YOLO worker stopped before returning a result. Check server logs for the Python process.";
}

function getPositiveTimeoutMs(value, fallback) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : fallback;
}

export function getYoloPersonExecutionTimeoutMs({ timeoutMs, coldTimeoutMs, warmedUp, reusesProcess = false } = {}) {
  const standardTimeoutMs = getPositiveTimeoutMs(timeoutMs, DEFAULT_TIMEOUT_MS);
  const firstRunTimeoutMs = getPositiveTimeoutMs(coldTimeoutMs, DEFAULT_COLD_TIMEOUT_MS);
  return reusesProcess && warmedUp ? standardTimeoutMs : Math.max(standardTimeoutMs, firstRunTimeoutMs);
}

function logServiceMessage(logger, level, ...args) {
  const logFunction = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof logFunction === "function") {
    logFunction.call(logger, ...args);
  }
}

async function withTemporaryImage(dataUrl, callback) {
  const match = String(dataUrl || "").match(DATA_URL_PATTERN);
  if (!match) {
    return {
      status: "failed",
      provider: "yolo",
      error: "Photo is not a supported image data URL."
    };
  }

  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-yolo-person-"));
  const imagePath = join(directory, `submission${getImageExtension(mimeType)}`);

  try {
    await writeFile(imagePath, bytes);
    return await callback(imagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createYoloPersonDetectionService({
  enabled = String(process.env.WHERETOI_PERSON_DETECTION_PROVIDER ?? "yolo").toLowerCase() === "yolo",
  pythonCommand = process.env.WHERETOI_YOLO_PERSON_PYTHON ?? "python3",
  runnerPath = RUNNER_PATH,
  timeoutMs = getPositiveTimeoutMs(process.env.WHERETOI_YOLO_PERSON_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  coldTimeoutMs = getPositiveTimeoutMs(process.env.WHERETOI_YOLO_PERSON_COLD_TIMEOUT_MS, DEFAULT_COLD_TIMEOUT_MS),
  warmupTimeoutMs = getPositiveTimeoutMs(process.env.WHERETOI_YOLO_PERSON_WARMUP_TIMEOUT_MS, DEFAULT_WARMUP_TIMEOUT_MS)
} = {}) {
  let warmedUp = false;
  let workerState = null;
  let workerStartPromise = null;
  let requestQueue = Promise.resolve();
  let requestSequence = 0;
  let serviceLogger = null;
  let closed = false;

  function createWorkerResult(status, error = "") {
    return {
      status,
      provider: "yolo",
      model: process.env.WHERETOI_YOLO_PERSON_MODEL || DEFAULT_PERSON_MODEL,
      error
    };
  }

  function appendWorkerStderr(state, chunk) {
    state.stderr = `${state.stderr}${String(chunk || "")}`.slice(-4_000);
  }

  function settleWorkerStartup(state, result) {
    if (!state.startupResolve) return;
    clearTimeout(state.startupTimer);
    const resolve = state.startupResolve;
    state.startupResolve = null;
    resolve(result);
  }

  function settleWorkerRequest(state, result) {
    if (!state.pendingRequest) return;
    clearTimeout(state.pendingRequest.timer);
    const { resolve } = state.pendingRequest;
    state.pendingRequest = null;
    resolve(result);
  }

  function stopWorker(state = workerState, signal = "SIGTERM") {
    if (!state || state.process.exitCode !== null) return;
    state.process.kill(signal);
  }

  function handleWorkerMessage(state, message) {
    if (!message || typeof message !== "object") return;

    if (message.type === "ready") {
      const ready = message.status === "completed";
      state.ready = ready;
      warmedUp = ready;
      settleWorkerStartup(state, message);
      if (!ready) stopWorker(state);
      return;
    }

    if (
      message.type === "result" &&
      state.pendingRequest &&
      String(message.id || "") === state.pendingRequest.id
    ) {
      settleWorkerRequest(
        state,
        message.result && typeof message.result === "object"
          ? message.result
          : createWorkerResult("failed", "YOLO worker returned an invalid result.")
      );
    }
  }

  function handleWorkerExit(state, code, signal, error = null) {
    const details = cleanYoloPersonProcessError(
      error || new Error(`YOLO worker exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`),
      state.stderr
    );
    settleWorkerStartup(state, createWorkerResult("unavailable", details));
    settleWorkerRequest(state, createWorkerResult("failed", details));
    state.output.close();
    if (workerState === state) {
      workerState = null;
      warmedUp = false;
    }
  }

  function startWorker({ logger = serviceLogger } = {}) {
    if (!enabled) return Promise.resolve(createWorkerResult("skipped"));
    if (closed) {
      return Promise.resolve(createWorkerResult("unavailable", "YOLO worker service has been closed."));
    }
    if (workerState?.ready) return Promise.resolve(createWorkerResult("completed"));
    if (workerStartPromise) return workerStartPromise;

    serviceLogger = logger || serviceLogger;
    const startedAt = Date.now();
    logServiceMessage(serviceLogger, "info", `YOLO person worker starting: timeoutMs=${warmupTimeoutMs}`);

    const child = spawn(pythonCommand, [runnerPath, "--worker"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const state = {
      process: child,
      output: createInterface({ input: child.stdout }),
      stderr: "",
      ready: false,
      pendingRequest: null,
      startupResolve: null,
      startupTimer: null
    };
    workerState = state;

    state.output.on("line", (line) => {
      const message = parseYoloPersonJsonOutput(line);
      if (message) handleWorkerMessage(state, message);
    });
    child.stderr.on("data", (chunk) => appendWorkerStderr(state, chunk));
    child.once("error", (error) => handleWorkerExit(state, null, null, error));
    child.once("exit", (code, signal) => handleWorkerExit(state, code, signal));

    workerStartPromise = new Promise((resolve) => {
      state.startupResolve = resolve;
      state.startupTimer = setTimeout(() => {
        settleWorkerStartup(
          state,
          createWorkerResult(
            "unavailable",
            `YOLO worker model loading timed out after ${Math.round(warmupTimeoutMs / 1000)} seconds.`
          )
        );
        stopWorker(state);
      }, warmupTimeoutMs);
    })
      .then((result) => {
        const ready = result?.status === "completed";
        const level = ready ? "info" : "warn";
        const errorSuffix = result?.error ? ` error=${String(result.error).slice(0, 240)}` : "";
        logServiceMessage(
          serviceLogger,
          level,
          `YOLO person worker ${ready ? "ready" : "unavailable"}: durationMs=${Date.now() - startedAt}${errorSuffix}`
        );
        return result;
      })
      .finally(() => {
        workerStartPromise = null;
      });

    return workerStartPromise;
  }

  async function runWorkerRequest(imagePath) {
    const startupResult = await startWorker();
    if (startupResult?.status !== "completed") {
      return startupResult || createWorkerResult("unavailable", "YOLO worker did not become ready.");
    }
    if (!workerState?.ready) {
      return createWorkerResult("unavailable", "YOLO worker stopped after loading the model.");
    }

    const state = workerState;
    const id = `${process.pid}-${Date.now()}-${++requestSequence}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        settleWorkerRequest(
          state,
          createWorkerResult(
            "failed",
            `YOLO person detection timed out after ${Math.round(timeoutMs / 1000)} seconds before returning a result.`
          )
        );
        stopWorker(state);
      }, timeoutMs);

      state.pendingRequest = { id, resolve, timer };
      state.process.stdin.write(`${JSON.stringify({ id, imagePath })}\n`, (error) => {
        if (!error) return;
        settleWorkerRequest(state, createWorkerResult("failed", cleanYoloPersonProcessError(error, state.stderr)));
        stopWorker(state);
      });
    });
  }

  function queueWorkerRequest(imagePath) {
    const request = requestQueue.then(() => runWorkerRequest(imagePath));
    requestQueue = request.catch(() => {});
    return request;
  }

  async function runPersonDetection(dataUrl) {
    return withTemporaryImage(dataUrl, (imagePath) => queueWorkerRequest(imagePath));
  }

  return {
    provider: "yolo",
    enabled,
    timeoutMs,
    coldTimeoutMs,
    warmupTimeoutMs,
    get warmedUp() {
      return warmedUp;
    },
    getExecutionTimeoutMs() {
      return getYoloPersonExecutionTimeoutMs({ timeoutMs, coldTimeoutMs, warmedUp, reusesProcess: true });
    },
    start({ logger } = {}) {
      return startWorker({ logger });
    },
    warmUp({ logger } = {}) {
      return startWorker({ logger });
    },
    async detectPeople({ dataUrl } = {}) {
      if (!enabled) {
        return createPersonDetectionEvidence({
          provider: "yolo",
          status: "unavailable",
          error: "YOLO person detection is not enabled."
        });
      }

      const rawResult = await runPersonDetection(dataUrl);
      if (rawResult?.status !== "failed" && rawResult?.status !== "unavailable") {
        warmedUp = true;
      }

      return createPersonDetectionEvidence({
        provider: rawResult.provider || "yolo",
        model: rawResult.model || process.env.WHERETOI_YOLO_PERSON_MODEL || DEFAULT_PERSON_MODEL,
        status: rawResult.status || "completed",
        boxes: rawResult.boxes || [],
        image: rawResult.image || null,
        blurredImage: rawResult.blurredImage || null,
        blurred: rawResult.blurred || false,
        blurError: rawResult.blurError || "",
        error: rawResult.error || "",
        checkedAt: new Date().toISOString()
      });
    },
    async close() {
      closed = true;
      const state = workerState;
      if (!state) return;

      settleWorkerStartup(state, createWorkerResult("unavailable", "YOLO worker service is shutting down."));
      settleWorkerRequest(state, createWorkerResult("failed", "YOLO worker service is shutting down."));
      if (state.process.exitCode !== null) return;

      await new Promise((resolve) => {
        const forceTimer = setTimeout(() => {
          stopWorker(state, "SIGKILL");
        }, 2_000);
        const handleExit = () => {
          clearTimeout(forceTimer);
          resolve();
        };
        state.process.once("exit", handleExit);
        if (state.process.exitCode !== null) {
          state.process.off("exit", handleExit);
          handleExit();
          return;
        }
        stopWorker(state);
      });
    },
    toString() {
      return `YOLO person detection worker (${basename(pythonCommand)})`;
    }
  };
}
