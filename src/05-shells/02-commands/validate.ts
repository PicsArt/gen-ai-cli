import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { Flags } from '@oclif/core';
import { findModel, Models } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import { ValidationError } from '#infra/errors/validation.ts';
import { BaseCommand } from '#root/base-command.ts';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      data += `${line}\n`;
    });
    rl.on('close', () => resolve(data.trim()));
  });
}

export default class Validate extends BaseCommand {
  static description = "Validate a generation payload against a model's parameter schema";

  static examples = [
    {
      command: '<%= config.bin %> validate -m flux-pro --file payload.json',
      description: 'Validate a payload file against model schema',
    },
    {
      command: '<%= config.bin %> validate -m kling-v3-pro --schema',
      description: "Print the model's parameter schema",
    },
    {
      command: 'echo \'{"prompt":"test"}\' | <%= config.bin %> validate -m kling-v3-pro',
      description: 'Validate JSON from stdin',
    },
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    model: Flags.string({
      char: 'm',
      description: 'Model ID, name, or workflow',
      required: true,
    }),
    file: Flags.string({
      char: 'f',
      description: 'Read payload from JSON file',
    }),
    schema: Flags.boolean({
      description: 'Print model schema as JSON and exit',
      default: false,
    }),
  };

  async run() {
    const { flags } = await this.parse(Validate);

    const model = findModel(flags.model);
    if (!model) {
      throw new UsageError(`Model not found: ${flags.model}`);
    }

    if (flags.schema) {
      const schema = Models.toSchema(model.id);
      this.out.json(schema);
      return;
    }

    let inputStr: string;
    if (flags.file) {
      try {
        inputStr = fs.readFileSync(flags.file, 'utf-8');
      } catch {
        throw new UsageError(`File not found: ${flags.file}`);
      }
    } else if (!process.stdin.isTTY) {
      inputStr = await readStdin();
    } else {
      throw new UsageError('Provide input via --file or stdin');
    }

    let input: unknown;
    try {
      input = JSON.parse(inputStr);
    } catch {
      throw new UsageError('Invalid JSON input');
    }

    const result = Models.validate(model.id, input);
    if (result.valid) {
      this.out.success(`Valid payload for ${model.name} (${model.id})`);
    } else {
      const fieldErrors = (result.errors ?? ['Validation failed']).map((e: string) => ({
        field: 'payload',
        message: e,
      }));
      throw new ValidationError(fieldErrors);
    }
  }
}
