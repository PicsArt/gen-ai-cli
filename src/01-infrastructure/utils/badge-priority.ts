import type { ModelDefinition } from '@picsart/ai-sdk';

/** Sort priority based on model badges: hot > new+popular > new > popular > rest. */
export function badgePriority(m: ModelDefinition): number {
  const b = m.badge ?? [];
  if (b.includes('hot')) return 0;
  if (b.includes('new') && b.includes('popular')) return 1;
  if (b.includes('new')) return 2;
  if (b.includes('popular')) return 3;
  return 4;
}
