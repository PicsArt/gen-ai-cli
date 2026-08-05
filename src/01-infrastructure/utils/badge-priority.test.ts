import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { badgePriority } from './badge-priority.ts';

function model(badges?: ModelDefinition['badge']): ModelDefinition {
  return { badge: badges } as unknown as ModelDefinition;
}

describe('badgePriority', () => {
  it('hot wins everything', () => {
    expect(badgePriority(model(['hot']))).toBe(0);
    expect(badgePriority(model(['hot', 'new', 'popular']))).toBe(0);
  });

  it('new + popular beats either alone', () => {
    expect(badgePriority(model(['new', 'popular']))).toBe(1);
  });

  it('new alone is third', () => {
    expect(badgePriority(model(['new']))).toBe(2);
  });

  it('popular alone is fourth', () => {
    expect(badgePriority(model(['popular']))).toBe(3);
  });

  it('no badge defaults to last bucket', () => {
    expect(badgePriority(model())).toBe(4);
    expect(badgePriority(model([]))).toBe(4);
  });
});
