import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApiError, type GenerationEvent, type ModelDefinition } from '@picsart/ai-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputManager } from '#infra/ui-core/output.ts';
import { runBatch, saveAndDownload } from './helpers.ts';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  generateText: vi.fn(),
  submit: vi.fn(),
  subscribe: vi.fn(),
  findModel: vi.fn(),
  resolveInputs: vi.fn(),
}));

vi.mock('@picsart/ai-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@picsart/ai-sdk')>()),
  createClient: () => mocks,
  findModel: mocks.findModel,
}));
vi.mock('#services/client.ts', () => ({
  getAuthenticatedFetch: async () => ({ authenticatedFetch: vi.fn(), creds: { token: 'test', uid: 'test' } }),
}));
vi.mock('#pipeline/02-resolve/media.ts', () => ({ resolveGenerationInputs: mocks.resolveInputs }));

const out = { info: vi.fn(), success: vi.fn(), error: vi.fn() } as unknown as OutputManager;
const dirs: string[] = [];
const model = (extra: Partial<ModelDefinition> = {}): ModelDefinition =>
  ({ id: 'test-model', name: 'Test model', mode: 'video', ...extra }) as ModelDefinition;
const manifest = { jobs: [{ id: 'one', model: 'test-model', prompt: 'hello' }] };
const options = { concurrency: 1, output: 'unused' };
async function* events(...updates: GenerationEvent[]) {
  yield* updates;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findModel.mockReturnValue(model());
  mocks.submit.mockResolvedValue('generation-123');
  mocks.resolveInputs.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('batch SDK 6 execution', () => {
  it('routes text to generateText and persists text without a media download', async () => {
    mocks.findModel.mockReturnValue(model({ mode: 'text' }));
    mocks.generateText.mockResolvedValue({ text: 'The generated answer.' });
    const result = await runBatch(manifest, options, out);
    expect(mocks.generateText).toHaveBeenCalledWith('test-model', { prompt: 'hello' });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.jobs).toEqual([expect.objectContaining({ status: 'completed', text: 'The generated answer.' })]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-batch-'));
    dirs.push(dir);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await saveAndDownload(result, dir, { noDownload: false, downloadConcurrency: 1 }, out);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).jobs[0].text).toBe(
      'The generated answer.',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(result.jobs[0].localPath).toBeUndefined();
  });

  it('records one media result from a completed event', async () => {
    mocks.subscribe.mockImplementation(() =>
      events(
        { type: 'generation.progress', progress: { percent: 25 } },
        { type: 'generation.completed', result: { url: 'https://example.test/video.mp4', items: [], results: [] } },
      ),
    );
    const result = await runBatch(manifest, options, out);
    expect(mocks.submit).toHaveBeenCalledWith('test-model', { prompt: 'hello' });
    expect(result.jobs).toEqual([
      expect.objectContaining({ status: 'completed', url: 'https://example.test/video.mp4' }),
    ]);
  });

  it('records one failure from SDK failure events', async () => {
    mocks.subscribe.mockImplementation(() =>
      events({
        type: 'generation.failed',
        error: new ApiError('Worker rejected input', { code: 'generation_failed', status: 502 }),
      }),
    );
    const result = await runBatch(manifest, options, out);
    expect(result.jobs).toEqual([expect.objectContaining({ status: 'failed', error: 'Worker rejected input' })]);
  });

  it('records one failure when subscription ends without a terminal event', async () => {
    mocks.subscribe.mockImplementation(() => events({ type: 'generation.progress' }));
    const result = await runBatch(manifest, options, out);
    expect(result.jobs).toEqual([
      expect.objectContaining({ status: 'failed', error: 'Job ended without terminal status' }),
    ]);
  });

  it.each([
    { deprecated: true },
    { release: 'preview' as const },
    { mode: 'json' as const },
  ])('rejects unavailable model %j before upload or provider execution', async (extra) => {
    mocks.findModel.mockReturnValue(model(extra));
    const result = await runBatch(manifest, options, out);
    expect(result.jobs).toEqual([
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('unavailable') }),
    ]);
    expect(mocks.resolveInputs).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
