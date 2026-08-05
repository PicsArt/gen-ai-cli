/**
 * FlowSpec — type-only sub-part. The "tests" exercise the type by
 * constructing realistic FlowSpec literals through `defineFlow` and
 * asserting their shape at runtime. If the type gets a breaking
 * change, these literals stop compiling.
 */
import { describe, expect, it } from 'vitest';
import { defineFlow, type FlowSpec, type RequiredInput } from './flow-spec.ts';

describe('defineFlow', () => {
  it('passes the spec through unchanged at runtime', () => {
    const spec = defineFlow({
      id: 'sample',
      description: 'Sample flow',
      modelFilter: () => true,
      staticFlagGroups: ['universal'],
      staticStepGroups: [],
      requiredInputs: [],
    });
    expect(spec.id).toBe('sample');
    expect(spec.description).toBe('Sample flow');
    expect(spec.staticFlagGroups).toEqual(['universal']);
  });

  it('preserves optional fields when provided', () => {
    const spec = defineFlow({
      id: 'with-defaults',
      description: 'Has default model and examples',
      modelFilter: () => true,
      staticFlagGroups: ['universal', 'output', 'model'],
      staticStepGroups: ['output', 'confirm'],
      requiredInputs: ['prompt'],
      defaultModel: 'some-model-id',
      examples: ['gen-ai with-defaults -p "hello"'],
    });
    expect(spec.defaultModel).toBe('some-model-id');
    expect(spec.examples).toEqual(['gen-ai with-defaults -p "hello"']);
  });
});

describe('FlowSpec — required inputs union', () => {
  it('every variant of RequiredInput is structurally a string', () => {
    const all: RequiredInput[] = ['prompt', 'image', 'video', 'audio'];
    for (const input of all) expect(typeof input).toBe('string');
  });
});

describe('FlowSpec — realistic specs compile and read back cleanly', () => {
  it('a generation-style flow (prompt input, model picker)', () => {
    const generate: FlowSpec = defineFlow({
      id: 'generate',
      description: 'Generate an image or video from a prompt',
      modelFilter: (m) => m.id.length > 0, // trivial predicate, real flows check capabilities
      staticFlagGroups: ['universal', 'output', 'model'],
      staticStepGroups: ['output', 'confirm'],
      requiredInputs: ['prompt'],
    });
    expect(generate.requiredInputs).toContain('prompt');
    expect(generate.staticFlagGroups).toContain('model');
  });

  it('an image-operation-style flow (image input, no prompt needed)', () => {
    const removeBg: FlowSpec = defineFlow({
      id: 'remove-bg',
      description: 'Remove the background from an image',
      modelFilter: (m) => m.id.startsWith('removebg'),
      staticFlagGroups: ['universal', 'output', 'model'],
      staticStepGroups: ['output', 'confirm'],
      requiredInputs: ['image'],
    });
    expect(removeBg.requiredInputs).toEqual(['image']);
  });
});
