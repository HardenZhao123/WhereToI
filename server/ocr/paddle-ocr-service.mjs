import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOcrEvidenceUpdate } from "./ocr-analysis.mjs";

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i;
const DEFAULT_TIMEOUT_MS = 180_000;
const OCR_PROCESS_MAX_BUFFER = 8 * 1024 * 1024;
const RUNNER_PATH = fileURLToPath(new URL("../../scripts/paddle_ocr_runner.py", import.meta.url));

function getImageExtension(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

export function parsePaddleOcrJsonOutput(output) {
  const text = String(output || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // PaddleOCR/tqdm can write progress before our JSON result. Walk backwards
    // and parse the last object-shaped suffix rather than failing on the noise.
  }

  for (let index = text.lastIndexOf("{"); index >= 0; index = text.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Keep looking for an earlier JSON object start.
    }
  }
  return null;
}

function cleanPaddleOcrProcessError(error, stderr) {
  const rawText = String(stderr || error?.message || "PaddleOCR did not return valid JSON.");
  const lines = rawText
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      !line.includes("%|") &&
      !/\b(?:[kmgt]?ib\/s|it\/s|eta)\b/i.test(line) &&
      !line.startsWith("Command failed:")
    );

  const usefulText = lines.join(" ").trim();
  return usefulText || "PaddleOCR failed before returning a valid result. Check Render logs for the Python OCR process.";
}

function execFileJson(command, args, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: OCR_PROCESS_MAX_BUFFER
      },
      (error, stdout, stderr) => {
        const result = parsePaddleOcrJsonOutput(stdout);
        if (result) {
          resolve(result);
          return;
        }

        const timedOut = error?.killed || error?.signal === "SIGTERM";
        resolve({
          status: "failed",
          provider: "paddleocr",
          error: timedOut
            ? `PaddleOCR timed out after ${Math.round(timeoutMs / 1000)} seconds before returning a result.`
            : cleanPaddleOcrProcessError(error, stderr)
        });
      }
    );
  });
}

async function withTemporaryImage(dataUrl, callback) {
  const match = String(dataUrl || "").match(DATA_URL_PATTERN);
  if (!match) {
    return {
      status: "failed",
      provider: "paddleocr",
      error: "Submission photo is not a supported image data URL."
    };
  }

  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-ocr-"));
  const imagePath = join(directory, `submission${getImageExtension(mimeType)}`);

  try {
    await writeFile(imagePath, bytes);
    return await callback(imagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createPaddleOcrService({
  enabled = String(process.env.WHERETOI_OCR_PROVIDER ?? "").toLowerCase() === "paddle",
  pythonCommand = process.env.WHERETOI_PADDLEOCR_PYTHON ?? "python3",
  runnerPath = RUNNER_PATH,
  timeoutMs = Number(process.env.WHERETOI_PADDLEOCR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
} = {}) {
  return {
    provider: "paddleocr",
    enabled,
    timeoutMs,
    async extractText({ dataUrl } = {}) {
      if (!enabled) {
        return createOcrEvidenceUpdate({
          provider: "paddleocr",
          status: "unavailable",
          error: "PaddleOCR is not enabled. Set WHERETOI_OCR_PROVIDER=paddle to run local OCR."
        });
      }

      const rawResult = await withTemporaryImage(dataUrl, (imagePath) =>
        execFileJson(pythonCommand, [runnerPath, imagePath], { timeoutMs })
      );

      return createOcrEvidenceUpdate({
        provider: rawResult.provider || "paddleocr",
        status: rawResult.status || "completed",
        text: rawResult.text || "",
        lines: rawResult.lines || [],
        confidence: rawResult.confidence,
        error: rawResult.error || "",
        checkedAt: new Date().toISOString()
      });
    },
    toString() {
      return `Paddle OCR service (${basename(pythonCommand)})`;
    }
  };
}
