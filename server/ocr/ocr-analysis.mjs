const KEYWORD_DEFINITIONS = [
  {
    id: "toilet",
    label: "Toilet",
    pattern: /\b(?:toilets?|lavator(?:y|ies)|restrooms?|bathrooms?)\b/i
  },
  {
    id: "wc",
    label: "WC",
    pattern: /\bW\.?\s*C\.?\b/i
  },
  {
    id: "public-convenience",
    label: "Public convenience",
    pattern: /\bpublic\s+conveniences?\b/i
  },
  {
    id: "accessible",
    label: "Accessible",
    pattern: /\b(?:accessible|disabled|wheelchair|radar\s+key|changing\s+places)\b/i
  },
  {
    id: "baby-changing",
    label: "Baby changing",
    pattern: /\b(?:baby\s+chang(?:e|ing)|babycare|nappy\s+chang(?:e|ing))\b/i
  }
];

const OPENING_HOURS_PATTERN =
  /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|open|closed|opening\s+hours?|24\s*(?:hours?|hrs?)|\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\s*(?:-|to|until|–)\s*\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?)\b/i;

function normaliseOcrLine(line) {
  if (typeof line === "string") {
    return { text: line.trim(), confidence: null };
  }

  const text = String(line?.text ?? "").trim();
  const confidenceValue = Number(line?.confidence ?? line?.score);
  return {
    text,
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null
  };
}

function dedupeByText(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item?.text ?? item?.label ?? "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyseOcrText({ text = "", lines = [], confidence = null } = {}) {
  const normalisedLines = Array.isArray(lines)
    ? lines.map(normaliseOcrLine).filter((line) => line.text)
    : [];
  const combinedText = String(text || normalisedLines.map((line) => line.text).join("\n")).trim();

  const keywords = KEYWORD_DEFINITIONS
    .map((definition) => {
      const match = combinedText.match(definition.pattern);
      return match
        ? {
            id: definition.id,
            label: definition.label,
            matchedText: match[0]
          }
        : null;
    })
    .filter(Boolean);

  const openingHoursHints = dedupeByText(
    normalisedLines
      .filter((line) => OPENING_HOURS_PATTERN.test(line.text))
      .map((line) => ({ text: line.text, confidence: line.confidence }))
  ).slice(0, 8);

  const lineConfidences = normalisedLines
    .map((line) => line.confidence)
    .filter((value) => Number.isFinite(value));
  const fallbackConfidence = lineConfidences.length > 0
    ? lineConfidences.reduce((sum, value) => sum + value, 0) / lineConfidences.length
    : null;
  const hasConfidence = confidence !== null && confidence !== undefined && confidence !== "";
  const confidenceValue = Number(confidence);

  return {
    text: combinedText.slice(0, 6000),
    lines: normalisedLines.slice(0, 60),
    keywords,
    openingHoursHints,
    confidence: hasConfidence && Number.isFinite(confidenceValue)
      ? Math.max(0, Math.min(1, confidenceValue))
      : fallbackConfidence
  };
}

export function createOcrEvidenceUpdate({
  provider = "paddleocr",
  status = "completed",
  text = "",
  lines = [],
  confidence = null,
  error = "",
  checkedAt = new Date().toISOString()
} = {}) {
  const analysis = analyseOcrText({ text, lines, confidence });
  const hasText = analysis.text.length > 0;
  const safeStatus = status === "completed" && !hasText ? "no_text" : status;

  return {
    status: safeStatus,
    provider,
    text: analysis.text,
    lines: analysis.lines,
    keywords: analysis.keywords,
    openingHoursHints: analysis.openingHoursHints,
    confidence: analysis.confidence,
    error: String(error || "").slice(0, 600),
    checkedAt
  };
}
