import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCheckSkills } from './check-skills.ts';

describe('check-skills', () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'csrc-'));
    dest = mkdtempSync(join(tmpdir(), 'cdst-'));
    mkdirSync(join(src, 'a'));
    mkdirSync(join(src, 'b'));
    writeFileSync(join(src, 'a', 'SKILL.md'), 'x');
    writeFileSync(join(src, 'b', 'SKILL.md'), 'x');
    mkdirSync(join(dest, 'a'));
    process.env.GEN_AI_SKILLS_SRC = src;
    process.env.GEN_AI_SKILLS_DEST = dest;
  });
  afterEach(() => {
    delete process.env.GEN_AI_SKILLS_SRC;
    delete process.env.GEN_AI_SKILLS_DEST;
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it('reports installed and missing', async () => {
    const out = await runCheckSkills();
    expect(out.source_skills.sort()).toEqual(['a', 'b']);
    expect(out.installed_skills).toEqual(['a']);
    expect(out.missing).toEqual(['b']);
  });
});
