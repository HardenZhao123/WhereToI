export function normaliseText(value) {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

export function toFeatureFlag(value) {
  const normalised = normaliseText(value).toLowerCase();
  if (normalised === "true") return "Y";
  if (normalised === "false") return "N";
  return "?";
}
