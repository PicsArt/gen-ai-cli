import { describe, expect, it } from 'vitest';
import { getSessionId, uuidv7 } from './session-id.ts';

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('matches the canonical UUID format with version=7 + RFC4122 variant', () => {
    for (let i = 0; i < 50; i++) expect(uuidv7()).toMatch(UUID_V7_RE);
  });

  it('produces unique values across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(uuidv7());
    expect(ids.size).toBe(500);
  });

  it('is time-ordered when called in sequence', () => {
    const a = uuidv7();
    // small delay so ms timestamp changes
    const b = uuidv7();
    // first 48 bits are timestamp — alphabetically sortable
    expect(a.slice(0, 13) <= b.slice(0, 13)).toBe(true);
  });
});

describe('getSessionId', () => {
  it('returns the same id on repeated calls within the process', () => {
    const id1 = getSessionId();
    const id2 = getSessionId();
    expect(id1).toBe(id2);
  });

  it('returns a valid uuidv7', () => {
    expect(getSessionId()).toMatch(UUID_V7_RE);
  });
});
