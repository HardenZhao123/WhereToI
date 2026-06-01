const defaultCleanlinessScore = 7;

function normaliseVoteCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.trunc(count);
}

export function getCleanlinessScore(toilet) {
  const score = Number(toilet?.cleanliness);
  if (!Number.isFinite(score)) return defaultCleanlinessScore;
  return Math.min(Math.max(score, 0), 10);
}

export function getCleanlinessVoteStats(toilet) {
  const cleanCount = normaliseVoteCount(toilet?.cleanlinessSurvey?.yes);
  const notCleanCount = normaliseVoteCount(toilet?.cleanlinessSurvey?.no);
  const total = cleanCount + notCleanCount;
  const cleanPercent = total > 0 ? Math.round((cleanCount / total) * 100) : 0;
  const notCleanPercent = total > 0 ? 100 - cleanPercent : 0;

  return {
    cleanCount,
    notCleanCount,
    cleanPercent,
    notCleanPercent,
    total
  };
}

export function formatCleanlinessVotes(toilet) {
  const { cleanCount, notCleanCount, cleanPercent, notCleanPercent } = getCleanlinessVoteStats(toilet);
  return `${cleanCount} clean (${cleanPercent}%) | ${notCleanCount} not clean (${notCleanPercent}%)`;
}
