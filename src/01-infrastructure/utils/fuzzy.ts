/**
 * Simple fuzzy matching for model search and file filtering.
 * Scores based on character proximity and sequential matches.
 */

/** Score a fuzzy match of query against text. Higher = better. 0 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact substring match gets highest bonus
  if (t.includes(q)) return 1000 + (q.length / t.length) * 500;

  let score = 0;
  let qi = 0;
  let lastMatchIdx = -1;
  let consecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      // Bonus for consecutive matches
      if (lastMatchIdx === ti - 1) {
        consecutive++;
        score += consecutive * 5;
      } else {
        consecutive = 0;
      }
      // Bonus for matching at word boundaries (after -, _, space, or start)
      if (ti === 0 || '-_ .'.includes(t[ti - 1])) score += 15;
      lastMatchIdx = ti;
      qi++;
    }
  }

  // All query chars must match
  if (qi < q.length) return 0;

  // Bonus for shorter text (more specific match)
  score += Math.max(0, 20 - (t.length - q.length));

  return score;
}

/** Filter and rank items by fuzzy match score. Returns sorted results (best first). */
export function fuzzyFilter<T>(items: T[], query: string, accessor: (item: T) => string): T[] {
  if (!query.trim()) return items;

  const scored = items
    .map((item) => ({ item, score: fuzzyScore(query, accessor(item)) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ item }) => item);
}
