import { Args } from '@oclif/core';
import { findModel, Models } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { renderModelInfoLines } from '#infra/ui/model-info.ts';
import { renderCard } from '#infra/ui-core/components/card.ts';
import { BaseCommand } from '#root/base-command.ts';

export default class ModelsInfo extends BaseCommand {
  static description = 'Show detailed model information';
  static examples = [
    { command: '<%= config.bin %> models info flux-pro', description: 'Show details for a model' },
    { command: '<%= config.bin %> models info kling-v3-pro', description: 'Show details including parameters' },
    { command: '<%= config.bin %> models info flux-pro --json', description: 'Output as JSON (for scripting)' },
  ];

  static args = {
    model: Args.string({ description: 'Model ID or name', required: false }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    const { args } = await this.parse(ModelsInfo);

    if (!args.model) {
      const models = Models.list().filter((m) => !m.disabled);
      const sample = models.slice(0, 5).map((m) => m.id);

      if (this.isJsonMode) {
        this.out.json({ error: 'model argument required', availableModels: models.map((m) => m.id) });
        return;
      }

      const lines = [
        'Provide a model ID to see its details.',
        '',
        'Usage:  models info <model-id>',
        '',
        'Examples:',
        ...sample.map((id) => `  models info ${id}`),
        `  models info ${sample[0]} --json`,
        '',
        'Related:',
        '  models                                   List all models',
        '  models --mode video                      Filter by mode',
        `  models compare ${sample[0]} ${sample[1] ?? sample[0]}  Side-by-side comparison`,
        `  pricing ${sample[0]}                     Credit cost`,
        '  pricing                                  All model pricing',
        '  history                                  Recent generations',
        '',
        `Run "models" to see all ${models.length} available models.`,
      ];
      this.out.card(lines, { title: 'models info' });
      return;
    }

    const model = findModel(args.model);
    if (!model) {
      throw new UsageError(`Model not found: ${args.model}\n\nRun "models" to see available model IDs.`);
    }

    if (this.isJsonMode) {
      this.out.json({
        id: model.id,
        name: model.name,
        provider: model.provider,
        mode: model.mode,
        inputType: model.inputType,
        disabled: model.disabled ?? false,
        workflow: model.workflow,
        editWorkflow: model.editWorkflow,
        syncExecute: model.syncExecute ?? false,
        modelId: model.modelId,
        features: model.features,
        badge: model.badge,
        paramConfig: model.paramConfig,
        schema: Models.toSchema(model.id),
      });
      return;
    }

    const infoLines = renderModelInfoLines(model, this.color);

    process.stderr.write(
      `${renderCard(infoLines, {
        color: this.color,
        title: model.name,
        maxWidth: Math.min(process.stdout.columns || 100, 100),
        plain: this.isPlainMode,
      })}\n`,
    );
  }
}
