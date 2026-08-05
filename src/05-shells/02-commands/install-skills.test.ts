import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInstallSkills } from './install-skills.ts';

describe('install-skills', () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'isrc-'));
    dest = mkdtempSync(join(tmpdir(), 'idest-'));
    mkdirSync(join(src, 'sample-skill'));
    writeFileSync(join(src, 'sample-skill', 'SKILL.md'), '---\nname: sample-skill\ndescription: x\n---\n# Body');
    process.env.GEN_AI_SKILLS_SRC = src;
    process.env.GEN_AI_SKILLS_DEST = dest;
  });
  afterEach(() => {
    delete process.env.GEN_AI_SKILLS_SRC;
    delete process.env.GEN_AI_SKILLS_DEST;
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it('copies every skill folder from src to dest', async () => {
    const out = await runInstallSkills();
    expect(out.installed).toBe(1);
    expect(existsSync(join(dest, 'sample-skill', 'SKILL.md'))).toBe(true);
  });

  it('refuses to overwrite without --force', async () => {
    mkdirSync(join(dest, 'sample-skill'));
    writeFileSync(join(dest, 'sample-skill', 'SKILL.md'), 'existing');
    const out = await runInstallSkills();
    expect(out.skipped).toBe(1);
    expect(readFileSync(join(dest, 'sample-skill', 'SKILL.md'), 'utf-8')).toBe('existing');
  });

  it('overwrites with force=true', async () => {
    mkdirSync(join(dest, 'sample-skill'));
    writeFileSync(join(dest, 'sample-skill', 'SKILL.md'), 'existing');
    const out = await runInstallSkills({ force: true });
    expect(out.installed).toBe(1);
    expect(readFileSync(join(dest, 'sample-skill', 'SKILL.md'), 'utf-8')).toMatch(/Body/);
  });
});
