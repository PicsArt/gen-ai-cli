/**
 * Spec for boolean-flag argv normalization.
 *
 * oclif boolean flags reject an explicit value — `--flag true` errors with
 * "Unexpected argument: true", and only `--no-flag` sets false. Users
 * reasonably type `--flag false` / `--flag=true`. These helpers rewrite the
 * value forms into what oclif accepts, BEFORE parse, touching ONLY tokens
 * whose flag is known-boolean.
 */
import { Flags } from '@oclif/core';
import { describe, expect, it } from 'vitest';
import { booleanFlagForms, normalizeBooleanFlagArgv } from './normalize-boolean-argv.ts';

const FLAGS = {
  'generate-audio': Flags.boolean({ allowNo: true, aliases: ['audio-gen'] }),
  verbose: Flags.boolean({ allowNo: true, char: 'v' }),
  // A string flag whose value can legitimately be the literal "true"/"false".
  prompt: Flags.string({ char: 'p' }),
};

describe('booleanFlagForms', () => {
  it('maps every invocation form (name, aliases, char) to the canonical long name', () => {
    const forms = booleanFlagForms(FLAGS as unknown as Record<string, unknown>);
    expect(forms.get('generate-audio')).toBe('generate-audio');
    expect(forms.get('audio-gen')).toBe('generate-audio');
    expect(forms.get('verbose')).toBe('verbose');
    expect(forms.get('v')).toBe('verbose');
  });

  it('ignores non-boolean flags', () => {
    const forms = booleanFlagForms(FLAGS as unknown as Record<string, unknown>);
    expect(forms.has('prompt')).toBe(false);
    expect(forms.has('p')).toBe(false);
  });
});

describe('normalizeBooleanFlagArgv', () => {
  const forms = booleanFlagForms(FLAGS as unknown as Record<string, unknown>);
  const run = (argv: string[]) => normalizeBooleanFlagArgv(argv, forms);

  it('rewrites `--flag false` (space) to `--no-flag`', () => {
    expect(run(['--generate-audio', 'false'])).toEqual(['--no-generate-audio']);
  });

  it('rewrites `--flag true` (space) to `--flag`', () => {
    expect(run(['--generate-audio', 'true'])).toEqual(['--generate-audio']);
  });

  it('rewrites `--flag=false` / `--flag=true`', () => {
    expect(run(['--generate-audio=false'])).toEqual(['--no-generate-audio']);
    expect(run(['--generate-audio=true'])).toEqual(['--generate-audio']);
  });

  it('rewrites an alias the same way', () => {
    expect(run(['--audio-gen', 'false'])).toEqual(['--no-generate-audio']);
  });

  it('rewrites a char form to the canonical long `--no-flag`', () => {
    expect(run(['-v', 'false'])).toEqual(['--no-verbose']);
    expect(run(['-v', 'true'])).toEqual(['--verbose']);
  });

  it('is case-insensitive on the value', () => {
    expect(run(['--generate-audio', 'FALSE'])).toEqual(['--no-generate-audio']);
    expect(run(['--generate-audio=True'])).toEqual(['--generate-audio']);
  });

  it('leaves a bare boolean flag untouched', () => {
    expect(run(['--generate-audio'])).toEqual(['--generate-audio']);
    expect(run(['--no-generate-audio'])).toEqual(['--no-generate-audio']);
  });

  it('does NOT consume a following non-boolean token', () => {
    expect(run(['--generate-audio', '--model', 'seedance-2.5'])).toEqual([
      '--generate-audio',
      '--model',
      'seedance-2.5',
    ]);
  });

  it('never touches a string flag that legitimately takes true/false', () => {
    expect(run(['--prompt', 'false'])).toEqual(['--prompt', 'false']);
    expect(run(['-p', 'true'])).toEqual(['-p', 'true']);
    expect(run(['--prompt=false'])).toEqual(['--prompt=false']);
  });

  it('preserves everything after a `--` terminator verbatim', () => {
    expect(run(['--generate-audio', 'false', '--', '--generate-audio', 'true'])).toEqual([
      '--no-generate-audio',
      '--',
      '--generate-audio',
      'true',
    ]);
  });

  it('handles a realistic mixed argv', () => {
    expect(
      run(['-m', 'seedance-2.5', '-p', 'a person sings', '--audio', 'x.mp3', '--generate-audio', 'false']),
    ).toEqual(['-m', 'seedance-2.5', '-p', 'a person sings', '--audio', 'x.mp3', '--no-generate-audio']);
  });
});
