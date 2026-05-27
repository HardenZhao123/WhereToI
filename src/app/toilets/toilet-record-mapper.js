import { appConfig } from "../config/app-config.js";
import { normaliseText, toFeatureFlag } from "../utils/text.js";

function parseAreaName(areasField) {
  if (!areasField) return "Unknown area";

  try {
    const parsed = JSON.parse(areasField);
    if (typeof parsed?.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name.trim();
    }
  } catch {
    // Keep fallback value for malformed area entries.
  }

  return "Unknown area";
}

function parseOpeningTimes(openingTimesField) {
  if (!openingTimesField) return [];

  try {
    const parsed = JSON.parse(openingTimesField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDayHours(openingTimes, dayIndex) {
  const dayLabel = appConfig.dayLabels[dayIndex] ?? "Day";
  const slot = openingTimes[dayIndex];

  if (!Array.isArray(slot) || slot.length < 2) {
    return `${dayLabel} Closed`;
  }

  const [openTime, closeTime] = slot;
  if (!openTime || !closeTime) {
    return `${dayLabel} Closed`;
  }

  return `${dayLabel} ${openTime} - ${closeTime}`;
}

function inferBidetOrWashingFlag(record) {
  const searchableText = normaliseText(
    `${record.name ?? ""} ${record.notes ?? ""} ${record.payment_details ?? ""}`
  ).toLowerCase();

  if (!searchableText) return "?";

  if (
    /\b(bidet|wudu|ablution|shattaf)\b/.test(searchableText) ||
    searchableText.includes("muslim") ||
    searchableText.includes("prayer room washroom")
  ) {
    return "Y";
  }

  return "?";
}

export function mapRecordToToilet(record) {
  if (record.active !== "true") return null;

  const lat = Number(record.latitude);
  const lng = Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const openingTimes = parseOpeningTimes(record.opening_times);
  const note = normaliseText(record.notes);
  const paymentDetails = normaliseText(record.payment_details);
  const commentBody = note || paymentDetails || "No notes yet.";
  const name = normaliseText(record.name) || "Unnamed toilet";
  const area = parseAreaName(record.areas);
  const noPayment = normaliseText(record.no_payment).toLowerCase();
  const paid = noPayment === "false" || paymentDetails.length > 0;

  return {
    id: record.id || `${name}-${lat}-${lng}`,
    name,
    area,
    lat,
    lng,
    paid,
    comment: `Comment: ${commentBody}`,
    features: {
      women: toFeatureFlag(record.women),
      men: toFeatureFlag(record.men),
      accessible: toFeatureFlag(record.accessible),
      neutral: toFeatureFlag(record.all_gender),
      children: toFeatureFlag(record.children),
      babyChanging: toFeatureFlag(record.baby_change),
      bidet: inferBidetOrWashingFlag(record),
      automatic: toFeatureFlag(record.automatic),
      urinalOnly: toFeatureFlag(record.urinal_only),
      radarKey: toFeatureFlag(record.radar),
      free: toFeatureFlag(record.no_payment)
    },
    hours: {
      today: formatDayHours(openingTimes, appConfig.todayDayIndex),
      sat: formatDayHours(openingTimes, 5),
      sun: formatDayHours(openingTimes, 6)
    },
    cleanliness: Number(record.cleanliness) ?? 7
  };
}
