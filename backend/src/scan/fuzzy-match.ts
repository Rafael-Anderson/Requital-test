// Lightweight Levenshtein-distance similarity — no fuzzy-matching library
// exists in this repo yet (search.service.ts uses plain SQL `contains`,
// which isn't tolerant of OCR misreads like "Rose Stms"), and this use case
// (score a short OCR name against a shop's own, typically small, product +
// ingredient list) doesn't need anything more than a straightforward edit
// distance — not worth a new dependency for.

export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// 1 = identical, 0 = completely different (or either string empty).
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  return 1 - levenshteinDistance(x, y) / Math.max(x.length, y.length);
}

export interface MatchCandidate {
  id: number;
  type: 'product' | 'ingredient';
  name: string;
}

export interface ScoredMatch extends MatchCandidate {
  score: number;
}

// minScore is deliberately forgiving (OCR text is noisy) — the review
// screen is where a bad suggestion gets corrected, not this function.
export function findBestMatches(
  query: string,
  candidates: MatchCandidate[],
  limit = 3,
  minScore = 0.4,
): ScoredMatch[] {
  return candidates
    .map((c) => ({ ...c, score: similarity(query, c.name) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
