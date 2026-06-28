import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOcrEvidenceUpdate } from "./ocr-analysis.mjs";

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i;
const DEFAULT_TIMEOUT_MS = 45_000;
const RUNNER_PATH = fileURLToPath(new URL("../../scripts/paddle_ocr_runner.py", import.meta.url));

function getImageExtension(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function execFileJson(command, args, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const output = String(stdout || "").trim();
        if (output) {
          try {
            resolve(JSON.parse(output));
            return;
          } catch {
            // Fall through to the generic failure below.
          }
        }

        const timedOut = error?.killed || error?.signal === "SIGTERM";
        resolve({
          status: "failed",
          provider: "paddleocr",
          error: timedOut
            ? "PaddleOCR timed out before returning a result."
            : String(error?.message || stderr || "PaddleOCR did not return valid JSON.")
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
