/**
 * batch schema — print the JSON Schema for the batch manifest.
 *
 * Pipe it to a file and reference it via `"$schema"` in your manifest for
 * editor autocomplete + validation:
 *   gen-ai batch schema > batch.schema.json
 */
import { BaseCommand } from '#root/base-command.ts';
import { BATCH_MANIFEST_SCHEMA } from '#shells/02-commands/batch/manifest-schema.ts';

export default class BatchSchema extends BaseCommand {
  static description = 'Print the JSON Schema for the batch manifest';

  static examples = [
    { command: '<%= config.bin %> batch schema', description: 'Print the manifest JSON Schema' },
    { command: '<%= config.bin %> batch schema > batch.schema.json', description: 'Save it for editor validation' },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
  };

  async run() {
    this.out.result(JSON.stringify(BATCH_MANIFEST_SCHEMA, null, 2));
  }
}
