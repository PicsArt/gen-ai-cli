/**
 * `gen-ai dev:params` — drift detector between the SDK paramConfig
 * surface and the CLI's `ALIAS_MAP` / catalog wiring.
 *
 * Hidden by default — used by humans during param-surface work and by
 * CI as a regression gate. Returns a non-zero exit code when the report
 * has action items (unexpected orphans or closed gaps); CI can rely on
 * that to fail PRs that drift.
 *
 * Two output modes:
 *   - default      → human-friendly cards / colored sections
 *   - --json       → machine-parseable AuditReport
 */
import { Flags } from '@oclif/core';
import { Models } from '@picsart/ai-sdk';
import { renderCard } from '#infra/ui-core/components/card.ts';
import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import {
  ALIAS_MAP,
  type AuditReport,
  auditCatalog,
  findFileWiringGaps,
  loadCatalog,
  readResolverSources,
} from '#param-surface';
import { BaseCommand } from '#root/base-command.ts';

/**
 * Alias keys allowed in `ALIAS_MAP` without a backing SDK descriptor.
 * Each is an open gap in `@picsart/ai-sdk`, filed against the
 * `pa-gen-ai-sdk` repo that owns the catalog.
 */
const EXPECTED_ORPHANS: ReadonlySet<string> = new Set([
  'externalTaskId',
  // 'outputFormat' removed 2026-05-25 — now a real SDK descriptor (p.outputFormat
  // on GPT Image), so it is no longer an orphan alias.
  // 'model' removed 2026-07-29 — now a real SDK descriptor (Topaz enhance
  // engine, Flux 3 Video quality tier); ships as --model-version via ALIAS_MAP.
  'soundEffectPrompt',
  'bgmPrompt',
  'asmrMode',
]);

export default class DevParams extends BaseCommand {
  static summary = 'Audit the CLI parameter surface against the SDK catalog';
  static hidden = true;

  static description = `Walks the real SDK catalog and reports drift items: descriptors
without an alias entry, long flag names, orphan aliases, closed gaps,
and cross-model kind conflicts. Exits non-zero when CI-actionable
items are present.`;

  static examples = [
    { command: '<%= config.bin %> dev:params', description: 'Human-friendly report' },
    { command: '<%= config.bin %> dev:params --json', description: 'Machine-readable report for CI' },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    'long-flag-threshold': Flags.integer({
      description: 'Flag-name length above which to flag as long',
      default: 15,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DevParams);

    const catalog = loadCatalog(Models.list(), ALIAS_MAP);
    const fileWiringGaps = findFileWiringGaps(catalog, readResolverSources());
    const report = auditCatalog(catalog, new Set(Object.keys(ALIAS_MAP)), EXPECTED_ORPHANS, {
      longFlagThreshold: flags['long-flag-threshold'],
      fileWiringGaps,
    });

    if (this.isJsonMode) {
      this.out.json(report);
      if (report.hasActionItems) this.exit(1);
      return;
    }

    this.renderHumanReport(report);
    if (report.hasActionItems) this.exit(1);
  }

  private renderHumanReport(r: AuditReport): void {
    const { color } = this;

    // ── Summary card ──
    const summary = renderKeyValue(
      [
        ['SDK descriptors', color.bold(String(r.totalSurfaces))],
        ['  with explicit alias', color.success(String(r.withAlias))],
        ['  using default kebab name', color.dim(String(r.withoutAlias))],
      ],
      { color },
    );
    this.out.result(renderCard(summary.split('\n'), { color, title: 'gen-ai CLI — Parameter Audit' }));

    // ── Sections ──
    if (r.noAlias.length > 0) {
      this.out.info(`\n${r.noAlias.length} descriptor${r.noAlias.length === 1 ? '' : 's'} without an ALIAS_MAP entry`);
      this.out.info(color.dim('Each uses its derived kebab name. Review whether any deserve a short alias.'));
      for (const n of r.noAlias) this.out.info(`  ${n.key} ${color.dim('→')} --${n.flag}`);
    }

    if (r.longFlags.length > 0) {
      this.out.info(
        `\n${r.longFlags.length} flag${r.longFlags.length === 1 ? '' : 's'} longer than the threshold (candidates for shorter aliases)`,
      );
      for (const lf of r.longFlags) {
        const note =
          lf.aliases.length > 0
            ? color.dim(`(has ${lf.aliases.map((a) => `--${a}`).join(', ')})`)
            : color.warning('(no alias)');
        this.out.info(`  --${lf.flag} ${color.dim(`${lf.length} chars`)} ${note}`);
      }
    }

    if (r.orphans.length > 0) {
      this.out.info(
        `\n${r.orphans.length} alias entr${r.orphans.length === 1 ? 'y' : 'ies'} without a matching SDK descriptor`,
      );
      for (const o of r.orphans) {
        const note = o.expected ? color.dim('(known — exempt)') : color.error('(unexpected — typo or stale?)');
        this.out.info(`  ${o.alias} ${note}`);
      }
    }

    if (r.closedGaps.length > 0) {
      this.out.info(
        `\n${r.closedGaps.length} exempt orphan${r.closedGaps.length === 1 ? '' : 's'} no longer needed — SDK now declares these`,
      );
      this.out.info(color.dim('Remove these from EXPECTED_ORPHANS in src/05-shells/02-commands/dev/params.ts.'));
      for (const key of r.closedGaps)
        this.out.info(`  ${key} ${color.dim('→')} ${color.success('now in SDK catalog')}`);
    }

    if (r.conflicts.length > 0) {
      this.out.info(
        `\n${r.conflicts.length} descriptor${r.conflicts.length === 1 ? '' : 's'} with cross-model kind conflicts`,
      );
      this.out.info(color.dim('First-seen kind kept; divergent models tracked on surface.conflicts.'));
      for (const conflict of r.conflicts) {
        this.out.info(`  ${color.bold(conflict.key)} ${color.dim('— primary:')} ${conflict.primaryKind}`);
        for (const divergent of conflict.conflicts) {
          this.out.info(`    ${color.dim('conflict:')} ${divergent.kind} (${divergent.modelId})`);
        }
      }
    }

    if (r.fileWiringGaps.length > 0) {
      this.out.info(
        `\n${r.fileWiringGaps.length} file-kind descriptor${r.fileWiringGaps.length === 1 ? '' : 's'} not wired through the pipeline`,
      );
      this.out.info(color.dim('Flag is declared by Param Surface but the value never reaches the SDK ctx.'));
      this.out.info(
        color.dim('Add a branch in resolver.ts / execute.ts / validate.ts (or update FILES_KEY_BY_SDK_KEY).'),
      );
      for (const gap of r.fileWiringGaps) {
        const slot = gap.unmappedKey ? color.error('(no FILES_KEY_BY_SDK_KEY entry)') : `files.${gap.filesKey}`;
        this.out.info(`  ${color.bold(gap.sdkKey)} ${color.dim('→')} ${slot}`);
        const missing: string[] = [];
        if (gap.resolverMiss) missing.push('resolver.ts');
        if (gap.executeMiss) missing.push('execute.ts');
        if (gap.validateMiss) missing.push('validate.ts');
        this.out.info(`    ${color.error('missing in:')} ${missing.join(', ')}`);
      }
    }

    this.out.info('');
    if (r.hasActionItems) {
      this.out.warn('Action items above. CI will fail until they are addressed.');
    } else {
      this.out.success('No drift detected. Catalog is clean against the current ALIAS_MAP.');
    }
  }
}
