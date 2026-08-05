import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseCommand } from '#root/base-command.ts';

export interface CheckSkillsResult {
  status: 'ok';
  source_skills: string[];
  installed_skills: string[];
  missing: string[];
  dest: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function defaultSkillsSrc(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'skills'), // source mode (up 3)
    join(__dirname, '..', 'skills'), // bundled dist mode (up 1)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export async function runCheckSkills(): Promise<CheckSkillsResult> {
  const src = process.env.GEN_AI_SKILLS_SRC ?? defaultSkillsSrc();
  const dest = process.env.GEN_AI_SKILLS_DEST ?? join(homedir(), '.claude', 'skills');
  const sourceSkills = existsSync(src)
    ? readdirSync(src, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  const installedSkills = existsSync(dest)
    ? readdirSync(dest, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((n) => sourceSkills.includes(n))
    : [];
  const missing = sourceSkills.filter((s) => !installedSkills.includes(s));
  const result: CheckSkillsResult = {
    status: 'ok',
    source_skills: sourceSkills,
    installed_skills: installedSkills,
    missing,
    dest,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

export default class CheckSkills extends BaseCommand {
  static description = 'Inspect which gen-ai skills are installed into ~/.claude/skills/';

  async run(): Promise<void> {
    await runCheckSkills();
  }
}
