import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_COLD_TIMEOUT_MS = 180_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 180_000;
const DEFAULT_PERSON_MODEL = "yolo26n-seg.pt";
const PERSON_DETECTION_PROCESS_MAX_BUFFER = 8 * 1024 * 1024;
const RUNNER_PATH = fileURLToPath(new URL("../../scripts/yolo_person_runner.py", import.meta.url));
const WARMUP_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAK0lEQVR42u3OQQ0AAAgEoNP6p7ZkQICym5kAAAAAAAAAAAAAAAAAAOD1AoBAAAG8m0UxAAAAAElFTkSuQmCC";

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
  const rawText = String(stderr || error?.message || "YOLO did not return valid JSON.");
  const usefulText = rawText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Command failed:"))
    .join(" ")
    .trim();

  return usefulText || "YOLO person detection failed before returning a valid result. Check server logs for the Python process.";
}

function execFileJson(command, args, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: PERSON_DETECTION_PROCESS_MAX_BUFFER
      },
      (error, stdout, stderr) => {
        const result = parseYoloPersonJsonOutput(stdout);
        if (result) {
          resolve(result);
          return;
        }

        const timedOut = error?.killed || error?.signal === "SIGTERM";
        resolve({
          status: "failed",
          provider: "yolo",
          error: timedOut
            ? `YOLO person detection timed out after ${Math.round(timeoutMs / 1000)} seconds before returning a result.`
            : cleanYoloPersonProcessError(error, stderr)
        });
      }
    );
  });
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
  let warmupPromise = null;

  async function runPersonDetection(dataUrl, { executionTimeoutMs }) {
    return withTemporaryImage(dataUrl, (imagePath) =>
      execFileJson(pythonCommand, [runnerPath, imagePath], { timeoutMs: executionTimeoutMs })
    );
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
      return getYoloPersonExecutionTimeoutMs({ timeoutMs, coldTimeoutMs, warmedUp, reusesProcess: false });
    },
    async warmUp({ logger } = {}) {
      if (!enabled) return { status: "skipped", provider: "yolo" };
      if (warmedUp) return { status: "completed", provider: "yolo" };
      if (warmupPromise) return warmupPromise;

      const startedAt = Date.now();
      logServiceMessage(logger, "info", `YOLO person detection warmup started: timeoutMs=${warmupTimeoutMs}`);
      warmupPromise = runPersonDetection(WARMUP_IMAGE_DATA_URL, { executionTimeoutMs: warmupTimeoutMs })
        .then((rawResult) => {
          if (rawResult?.status !== "failed" && rawResult?.status !== "unavailable") {
            warmedUp = true;
          }
          const level = warmedUp ? "info" : "warn";
          const errorSuffix = rawResult?.error ? ` error=${String(rawResult.error).slice(0, 240)}` : "";
          logServiceMessage(
            logger,
            level,
            `YOLO person detection warmup finished: status=${rawResult?.status ?? "unknown"} durationMs=${Date.now() - startedAt}${errorSuffix}`
          );
          return rawResult;
        })
        .finally(() => {
          warmupPromise = null;
        });

      return warmupPromise;
    },
    async detectPeople({ dataUrl } = {}) {
      if (!enabled) {
        return createPersonDetectionEvidence({
          provider: "yolo",
          status: "unavailable",
          error: "YOLO person detection is not enabled."
        });
      }

      const executionTimeoutMs = getYoloPersonExecutionTimeoutMs({
        timeoutMs,
        coldTimeoutMs,
        warmedUp,
        reusesProcess: false
      });
      const rawResult = await runPersonDetection(dataUrl, { executionTimeoutMs });
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
    toString() {
      return `YOLO person detection service (${basename(pythonCommand)})`;
    }
  };
}
