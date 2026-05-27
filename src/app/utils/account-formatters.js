export function formatCurrency(amount) {
  const value = Number.isFinite(amount) ? amount : 0;
  return `GBP ${value.toFixed(2)}`;
}

export function formatRenewDate(dateValue) {
  if (!dateValue) return "Unknown";

  const parsed = new Date(dateValue);
  if (!Number.isFinite(parsed.getTime())) return dateValue;

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short"
  });
}

export function formatAccessTime(isoText) {
  const parsed = new Date(isoText);
  if (!Number.isFinite(parsed.getTime())) return "Unknown time";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const timeText = parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  if (parsed >= startOfToday) return `Today ${timeText}`;
  if (parsed >= startOfYesterday) return `Yesterday ${timeText}`;

  const dayText = parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short"
  });

  return `${dayText} ${timeText}`;
}

export function formatCharge(amountGbp) {
  const amount = Number(amountGbp);
  if (!Number.isFinite(amount) || amount <= 0) return "free access";
  return formatCurrency(amount);
}
