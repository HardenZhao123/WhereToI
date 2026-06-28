import assert from "node:assert/strict";
import test from "node:test";
import { parsePaddleOcrJsonOutput } from "../server/ocr/paddle-ocr-service.mjs";

test("PaddleOCR service parses JSON after model download progress output", () => {
  const output = [
    "  0%|          | 0.00/4.00M [00:00<?, ?iB/s]",
    "  5%|5         | 216k/4.00M [00:02<00:48, 79.2kiB/s]",
    '{"status":"completed","provider":"paddleocr","text":"Accessible WC","lines":[{"text":"Accessible WC","confidence":0.91}],"confidence":0.91}'
  ].join("\n");

  const parsed = parsePaddleOcrJsonOutput(output);

  assert.equal(parsed.status, "completed");
  assert.equal(parsed.provider, "paddleocr");
  assert.equal(parsed.text, "Accessible WC");
  assert.equal(parsed.lines[0].confidence, 0.91);
});

test("PaddleOCR service returns null when no JSON result is present", () => {
  assert.equal(parsePaddleOcrJsonOutput("0%| | 0.00/4.00M [00:00<?, ?iB/s]"), null);
});
