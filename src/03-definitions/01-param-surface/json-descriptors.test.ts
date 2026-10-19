import { Parser } from '@oclif/core';
import { ALL_MODELS, type ObjectDescriptor, type ParamDescriptor } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { coerceJsonObject, coerceToDescriptor } from './01-primitives/02-coercion/index.ts';
import { loadCatalog } from './02-catalog/index.ts';
import { generateFlagsFromCatalog } from './03-describe/01-flag-schema/index.ts';
import { generateWizardStepsFromCatalog } from './03-describe/02-wizard-schema/index.ts';
import { collectGenerationContext } from './04-interpret/01-flag-reader/index.ts';
import { collectContextFromAnswers } from './04-interpret/02-wizard-reader/index.ts';

const open: ObjectDescriptor = { kind: 'object', additionalProperties: { kind: 'unknown' } };
const catalog = (descriptor: ParamDescriptor) =>
  loadCatalog([{ id: 'json-model', paramConfig: { metadata: { descriptor, required: true } } }], {});

describe('SDK JSON descriptors', () => {
  it.each([
    null,
    true,
    0,
    'hello',
    [1, null, 'text'],
    { nested: { value: false } },
  ])('preserves native unknown JSON values: %j', (raw) => {
    expect(coerceToDescriptor(raw, { kind: 'unknown' })).toEqual(raw);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    () => 0,
    { value: undefined },
    BigInt(1),
  ])('rejects values JSON cannot represent', (raw) => {
    expect(() => coerceToDescriptor(raw, { kind: 'unknown' })).toThrow(/JSON/);
  });

  it('declares a parent JSON flag and prompt for open objects', () => {
    const cat = catalog(open);
    const flags = generateFlagsFromCatalog(cat) as Record<string, { description: string; multiple: boolean }>;
    expect(Object.keys(flags)).toEqual(['metadata']);
    expect(flags.metadata.description).toContain('JSON object');
    expect(flags.metadata.multiple).toBe(false);
    expect(generateWizardStepsFromCatalog(cat)).toEqual([
      { kind: 'text', key: 'metadata', label: 'Metadata (JSON object)', required: true },
    ]);
  });

  it('parses JSON CLI flags and wizard text while preserving nested keys and null', () => {
    const cat = catalog(open);
    const raw = '{"vendor":{"custom":[1,null,"text"]},"enabled":false}';
    const expected = { metadata: JSON.parse(raw) };
    expect(collectGenerationContext({ metadata: raw }, cat)).toEqual(expected);
    expect(collectContextFromAnswers({ metadata: raw }, cat)).toEqual(expected);
    expect(collectContextFromAnswers(expected, cat)).toEqual(expected);
    expect(collectGenerationContext({}, cat)).toEqual({});
  });

  it.each(['bad-json', 'null', '[]', '42'])('rejects invalid open object input %s', (raw) => {
    expect(() => collectGenerationContext({ metadata: raw }, catalog(open))).toThrow(/JSON/);
    expect(() => collectContextFromAnswers({ metadata: raw }, catalog(open))).toThrow(/JSON/);
  });

  it('validates typed dictionaries recursively and honours optional fields', () => {
    const descriptor: ObjectDescriptor = {
      kind: 'object',
      additionalProperties: {
        kind: 'object',
        fields: {
          count: { kind: 'range', min: 1, max: 5 },
          note: { kind: 'text', required: false },
        },
      },
    };
    expect(coerceJsonObject({ first: { count: '2' } }, descriptor)).toEqual({ first: { count: 2 } });
    expect(() => coerceJsonObject({ first: { count: 9 } }, descriptor)).toThrow(/range/);
    expect(() => coerceJsonObject({ first: {} }, descriptor)).toThrow(/count/);
    expect(() => coerceJsonObject({ first: { count: 2, extra: 1 } }, descriptor)).toThrow(/extra/);
  });

  it('preserves extras alongside declared fields without skipping field validation', () => {
    const descriptor: ObjectDescriptor = { ...open, fields: { count: { kind: 'range', min: 1, max: 5 } } };
    const cat = catalog(descriptor);
    expect(Object.keys(generateFlagsFromCatalog(cat))).toEqual(['metadata']);
    expect(collectGenerationContext({ metadata: '{"count":"2","extra":"true"}' }, cat)).toEqual({
      metadata: { count: 2, extra: 'true' },
    });
    expect(() => collectContextFromAnswers({ metadata: { extra: 1 } }, cat)).toThrow(/count/);
  });

  it('accepts bounded JSON object arrays in both input paths', () => {
    const cat = catalog({ ...open, array: { min: 1, max: 2 } });
    expect(collectGenerationContext({ metadata: '[{"x":1},{"y":null}]' }, cat)).toEqual({
      metadata: [{ x: 1 }, { y: null }],
    });
    expect(collectContextFromAnswers({ metadata: [{ x: 1 }] }, cat)).toEqual({ metadata: [{ x: 1 }] });
    expect(() => collectContextFromAnswers({ metadata: [] }, cat)).toThrow(/at least 1/);
    expect(() => collectGenerationContext({ metadata: '[{},{},{}]' }, cat)).toThrow(/at most 2/);
  });

  it.each(['null', 'false', '42', '"text"', '[1,null]', '{"x":true}'])('reads unknown JSON %s', (raw) => {
    const cat = catalog({ kind: 'unknown' });
    expect(Object.keys(generateFlagsFromCatalog(cat))).toEqual(['metadata']);
    expect(generateWizardStepsFromCatalog(cat)[0]).toMatchObject({ kind: 'text', label: 'Metadata (JSON value)' });
    expect(collectGenerationContext({ metadata: raw }, cat)).toEqual({ metadata: JSON.parse(raw) });
    expect(collectContextFromAnswers({ metadata: raw }, cat)).toEqual({ metadata: JSON.parse(raw) });
  });

  it('does not allow special keys to alter object prototypes', () => {
    const cat = catalog(open);
    const ctx = collectGenerationContext({ metadata: '{"__proto__":{"polluted":true},"constructor":null}' }, cat);
    expect(ctx).toEqual({ metadata: JSON.parse('{"__proto__":{"polluted":true},"constructor":null}') });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('uses the selected model object descriptor rather than the merged first model', () => {
    const cat = loadCatalog(
      [
        {
          id: 'one',
          paramConfig: { metadata: { descriptor: { kind: 'object', fields: { value: { kind: 'text' } } } } },
        },
        { id: 'two', paramConfig: { metadata: { descriptor: open } } },
      ],
      {},
    );
    expect(collectGenerationContext({ metadata: '{"extra":1}' }, cat, 'two')).toEqual({ metadata: { extra: 1 } });
  });
});

it('round-trips the real typesafe-evaluate question dictionary without dropping vendor options', () => {
  const model = ALL_MODELS.find((model) => model.id === 'typesafe-evaluate');
  expect(model).toBeDefined();
  const cat = loadCatalog([model!], {});
  const questions = {
    quality: { type: 'score', instructions: { prompt: 'Rate quality', examples: [1, null] }, min: 1, max: 10 },
    valid: { instructions: 'Is the image valid?', vendorSetting: true },
  };
  const expected = { questions: { ...questions, valid: { type: 'noul', ...questions.valid } } };
  expect(collectGenerationContext({ questions: JSON.stringify(questions) }, cat)).toEqual(expected);
  expect(collectContextFromAnswers({ questions }, cat)).toEqual(expected);
  expect(() =>
    collectGenerationContext({ questions: '{"bad":{"type":"invalid","instructions":"test"}}' }, cat),
  ).toThrow(/Invalid value/);
});

it('declares and reads the real Gemini 3.8 parts-style flag across the universal catalog', async () => {
  const cat = loadCatalog(ALL_MODELS, {});
  const flags = generateFlagsFromCatalog(cat) as Record<string, { multiple?: boolean; description?: string }>;
  expect(flags['parts-style']).toMatchObject({ multiple: true });
  expect(flags['parts-style'].description).toContain('Style');
  const parsed = await Parser.parse(['--parts-text', 'Hello', '--parts-style', 'Whisper'], {
    flags: generateFlagsFromCatalog(cat) as Parser.FlagInput,
  });
  expect(collectGenerationContext(parsed.flags, cat, 'gemini-3.8-flash-tts')).toEqual({
    parts: [{ text: 'Hello', style: 'Whisper', speaker: undefined }],
  });
  expect(
    collectGenerationContext({ 'parts-text': ['Hello'], 'parts-style': ['Whisper'] }, cat, 'gemini-3.8-flash-tts'),
  ).toEqual({ parts: [{ text: 'Hello', style: 'Whisper', speaker: undefined }] });
  expect(collectGenerationContext({ 'parts-text': ['Hello'] }, cat, 'gemini-2.5-flash-tts')).toEqual({
    parts: [{ text: 'Hello', speaker: undefined }],
  });
});

it('declares both open JSON and structured flags when models share an object key', () => {
  const cat = loadCatalog(
    [
      {
        id: 'structured',
        paramConfig: {
          metadata: {
            descriptor: {
              kind: 'object',
              fields: {
                first: { kind: 'text' },
                second: { kind: 'text', required: false },
              },
            },
          },
        },
      },
      { id: 'open', paramConfig: { metadata: { descriptor: open } } },
    ],
    {},
  );
  expect(Object.keys(generateFlagsFromCatalog(cat)).sort()).toEqual(['metadata', 'metadata-first', 'metadata-second']);
  expect(collectGenerationContext({ metadata: '{"extra":1}' }, cat, 'open')).toEqual({ metadata: { extra: 1 } });
  expect(collectGenerationContext({ 'metadata-first': 'text' }, cat, 'structured')).toEqual({
    metadata: { first: 'text', second: undefined },
  });
});

it('retains single-field shortcuts and multi-field flags across different model shapes', () => {
  const cat = loadCatalog(
    [
      {
        id: 'single',
        paramConfig: { metadata: { descriptor: { kind: 'object', fields: { first: { kind: 'text' } } } } },
      },
      {
        id: 'multi',
        paramConfig: {
          metadata: {
            descriptor: {
              kind: 'object',
              array: {},
              fields: {
                first: { kind: 'text' },
                second: { kind: 'text', required: false },
              },
            },
          },
        },
      },
    ],
    {},
  );
  expect(Object.keys(generateFlagsFromCatalog(cat)).sort()).toEqual(['metadata', 'metadata-first', 'metadata-second']);
  expect(collectGenerationContext({ metadata: 'hello' }, cat, 'single')).toEqual({ metadata: { first: 'hello' } });
  expect(collectGenerationContext({ 'metadata-first': ['hello'] }, cat, 'multi')).toEqual({
    metadata: [{ first: 'hello', second: undefined }],
  });
});

it('normalizes shared repeatable flags while enforcing the selected scalar object shape', () => {
  const field = { first: { kind: 'text' as const } };
  const cat = loadCatalog(
    [
      { id: 'scalar', paramConfig: { metadata: { descriptor: { kind: 'object', fields: field } } } },
      { id: 'array', paramConfig: { metadata: { descriptor: { kind: 'object', array: {}, fields: field } } } },
    ],
    {},
  );
  expect(generateFlagsFromCatalog(cat).metadata).toMatchObject({ multiple: true });
  expect(collectGenerationContext({ metadata: ['hello'] }, cat, 'scalar')).toEqual({ metadata: { first: 'hello' } });
  expect(collectGenerationContext({ metadata: ['hello', 'world'] }, cat, 'array')).toEqual({
    metadata: [{ first: 'hello' }, { first: 'world' }],
  });
  expect(() => collectGenerationContext({ metadata: ['hello', 'world'] }, cat, 'scalar')).toThrow(/one value/);
});

it('propagates real object-array minimums and leaves unlimited arrays uncapped', () => {
  const models = ALL_MODELS.filter((model) => model.id === 'eleven-dialogue-v4');
  expect(models).toHaveLength(1);
  const step = generateWizardStepsFromCatalog(loadCatalog(models, {})).find((step) => step.key === 'dialogue');
  expect(step).toMatchObject({ kind: 'object', array: true, arrayMin: 1 });
  expect(step).not.toHaveProperty('arrayMax');
  const cat = catalog({ kind: 'object', array: { min: 2, max: 10 }, fields: { point: { kind: 'text' } } });
  expect(generateWizardStepsFromCatalog(cat)[0]).toMatchObject({ arrayMin: 2, arrayMax: 10 });
});
