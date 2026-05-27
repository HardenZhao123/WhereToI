const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY_DAY_INDEX = (new Date().getDay() + 6) % 7;

export function normaliseText(value) {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

function toFeatureFlag(value) {
  const normalised = normaliseText(value).toLowerCase();
  if (normalised === "true") return "Y";
  if (normalised === "false") return "N";
  return "?";
}

function parseCleanlinessScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 7;
  return Math.min(Math.max(score, 0), 10);
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

function parseAreaName(areasField) {
  if (!areasField) return "Unknown area";

  try {
    const parsed = JSON.parse(areasField);
    if (typeof parsed?.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name.trim();
    }
  } catch {
    // Ignore malformed area payloads.
  }

  return "Unknown area";
}

function parseOpeningTimes(openingTimesField) {
  if (!openingTimesField) return [];

  if (Array.isArray(openingTimesField)) {
    return openingTimesField;
  }

  try {
    const parsed = JSON.parse(openingTimesField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDayHours(openingTimes, dayIndex) {
  const dayLabel = DAY_LABELS[dayIndex] ?? "Day";
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

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    return normalised === "1" || normalised === "true" || normalised === "t";
  }
  return false;
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
    cleanliness: parseCleanlinessScore(record.cleanliness),
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
    openingTimes
  };
}

export function mapRowToToilet(row) {
  const openingTimes = parseOpeningTimes(row.opening_times);

  return {
    id: row.id,
    name: row.name,
    area: row.area,
    lat: Number(row.lat),
    lng: Number(row.lng),
    paid: toBoolean(row.paid),
    comment: row.comment,
    features: {
      women: row.women,
      men: row.men,
      accessible: row.accessible,
      neutral: row.neutral,
      children: row.children,
      babyChanging: row.baby_changing,
      bidet: row.bidet,
      automatic: row.automatic,
      urinalOnly: row.urinal_only,
      radarKey: row.radar_key,
      free: row.free_access
    },
    hours: {
      today: formatDayHours(openingTimes, TODAY_DAY_INDEX),
      sat: formatDayHours(openingTimes, 5),
      sun: formatDayHours(openingTimes, 6)
    },
    cleanliness: Number(row.cleanliness ?? 3),
    cleanlinessSurvey: {
      yes: Number(row.cleanliness_yes_count ?? 0),
      no: Number(row.cleanliness_no_count ?? 0)
    }
  };
}
