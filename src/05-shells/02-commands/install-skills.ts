import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Flags } from '@oclif/core';
import { BaseCommand } from '#root/base-command.ts';

export interface InstallSkillsResult {
  status: 'ok';
  installed: number;
  skipped: number;
  dest: string;
  skills: string[];
}

export interface RunInstallSkillsOptions {
  force?: boolean;
  to?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** A directory is a skills root only if it holds at least one `<name>/SKILL.md`. */
function containsSkills(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')),
    );
  } catch {
    return false; // missing or unreadable
  }
}

/**
 * Find the bundled `skills/` directory.
 *
 * The published package is flattened — `scripts/publish-package.mjs` publishes
 * from `dist/`, so `cli.js` sits at the package root with `skills/` beside it.
 * `join(__dirname, 'skills')` therefore covers BOTH the published package and
 * an in-repo `node dist/cli.js` run. (The old "up 1" candidate assumed
 * `dist/cli.js` stayed nested with `skills/` as a sibling of `dist/` — that
 * layout is never published, so bundled mode could never find its skills.)
 *
 * Source mode (tsx / `npm link`) falls back to the authoring location,
 * `install/skills/`, since the repo's own `skills/` is only a build target.
 *
 * Candidates are matched on CONTENT, not mere existence. The repo keeps
 * `skills/.gitkeep` so the directory is tracked while empty; an existence check
 * would stop there and silently install nothing, never reaching `install/skills/`.
 */
function defaultSkillsSrc(): string {
  const candidates = [
    join(__dirname, 'skills'), // published package + dist run
    join(__dirname, '..', '..', '..', 'skills'), // source mode, post-build
    join(__dirname, '..', '..', '..', 'install', 'skills'), // source mode, authoring dir
  ];
  return candidates.find(containsSkills) ?? candidates.find((c) => existsSync(c)) ?? candidates[0];
}

export async function runInstallSkills(opts: RunInstallSkillsOptions = {}): Promise<InstallSkillsResult> {
  const src = process.env.GEN_AI_SKILLS_SRC ?? defaultSkillsSrc();
  const dest = process.env.GEN_AI_SKILLS_DEST ?? opts.to ?? join(homedir(), '.claude', 'skills');
  if (!existsSync(src)) throw new Error(`Skills source not found: ${src}`);
  mkdirSync(dest, { recursive: true });

  // A skill is a directory with a SKILL.md at its root. Requiring the manifest
  // (rather than trusting any directory) keeps grouping folders out of the
  // install — `install/skills/workflows/` holds persona bundles that ship as
  // landing-page zips, and installing it whole would create one broken,
  // manifest-less "workflows" skill.
  const skills = readdirSync(src, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(src, d.name, 'SKILL.md')))
    .map((d) => d.name);
  let installed = 0;
  let skipped = 0;
  for (const skill of skills) {
    const target = join(dest, skill);
    if (existsSync(target) && !opts.force) {
      skipped++;
      process.stderr.write(`— ${skill} (already exists; use --force to overwrite)\n`);
      continue;
    }
    cpSync(join(src, skill), target, { recursive: true });
    installed++;
    process.stderr.write(`✓ ${skill}\n`);
  }

  const result: InstallSkillsResult = { status: 'ok', installed, skipped, dest, skills };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const msg = `\nInstalled ${installed} skill(s) to ${dest}.${skipped > 0 ? ` Skipped ${skipped} existing.` : ''} Restart Claude to load.\n`;
  process.stderr.write(msg);
  return result;
}

export default class InstallSkills extends BaseCommand {
  static description = 'Install gen-ai skill files into ~/.claude/skills/';
  static flags = {
    ...BaseCommand.baseFlags,
    force: Flags.boolean({ default: false, description: 'Overwrite existing skills' }),
    to: Flags.string({ description: 'Custom install location (default: ~/.claude/skills)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(InstallSkills);
    await runInstallSkills({ force: flags.force, to: flags.to });
  }
}
