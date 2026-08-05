/**
 * Shared concurrency pool — drives parallel batch uploads/downloads.
 */

/** Deduplicate `.id` fields in-place by appending `-1`, `-2`, etc. for collisions. */
export function deduplicateIds(items: { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const baseId = item.id;
    let candidate = baseId;
    let n = 1;
    while (seen.has(candidate)) candidate = `${baseId}-${n++}`;
    item.id = candidate;
    seen.add(candidate);
  }
}

export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Invalid concurrency: ${concurrency}. Expected a positive integer.`);
  }

  const queue = [...items];
  const active: Promise<void>[] = [];
  const errors: unknown[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      const promise = fn(item)
        .then(() => {
          const idx = active.indexOf(promise);
          if (idx !== -1) active.splice(idx, 1);
        })
        .catch((err: unknown) => {
          errors.push(err);
          const idx = active.indexOf(promise);
          if (idx !== -1) active.splice(idx, 1);
        });
      active.push(promise);
    }
    if (active.length > 0) await Promise.race(active);
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `${errors.length} tasks failed`);
}
