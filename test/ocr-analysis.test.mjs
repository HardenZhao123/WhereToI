import assert from "node:assert/strict";
import test from "node:test";
import { analyseOcrText, createOcrEvidenceUpdate } from "../server/ocr/ocr-analysis.mjs";

test("OCR analysis extracts toilet keywords and opening-hours hints", () => {
  const analysis = analyseOcrText({
    lines: [
      { text: "Public Convenience Toilets", confidence: 0.95 },
      { text: "Accessible WC and Baby Changing", confidence: 0.9 },
      { text: "Open Mon-Fri 09:00-17:00", confidence: 0.88 }
    ]
  });

  assert.deepEqual(
    analysis.keywords.map((keyword) => keyword.id),
    ["toilet", "wc", "public-convenience", "accessible", "baby-changing"]
  );
  assert.equal(analysis.openingHoursHints[0].text, "Open Mon-Fri 09:00-17:00");
  assert.match(analysis.text, /Accessible WC/);
  assert.equal(Math.round(analysis.confidence * 100), 91);
});

test("OCR evidence marks empty completed results as no_text", () => {
  const evidence = createOcrEvidenceUpdate({
    provider: "paddleocr",
    status: "completed",
    text: "",
    lines: []
  });

  assert.equal(evidence.status, "no_text");
  assert.equal(evidence.provider, "paddleocr");
});
