/**
 * workflow-match — flow predicates discriminate on `model.workflow` + `model.id`.
 *
 * SDK 5 replaced the old `toolId` mapping tree with a flat `workflow`
 * string. Some vendors reuse one workflow for several operations (every
 * seedance edit/extend variant ships workflow `"seedance"`), so the
 * matcher checks the model id as well.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { matchesWorkflowOrId } from './workflow-match.ts';

function model(id: string, workflow: string): ModelDefinition {
  return { id, workflow } as ModelDefinition;
}

describe('matchesWorkflowOrId', () => {
  it('matches on the workflow string', () => {
    expect(matchesWorkflowOrId(model('topaz-upscale-image', 'topaz/upscale/image'), /upscale/i)).toBe(true);
  });

  it('matches on the model id when the workflow is uninformative', () => {
    // Every seedance edit/extend variant shares workflow "seedance" —
    // only the id distinguishes extend from edit.
    expect(matchesWorkflowOrId(model('seedance-2.0-video-extend', 'seedance'), /extend/i)).toBe(true);
    expect(matchesWorkflowOrId(model('seedance-2.0-video-edit', 'seedance'), /extend/i)).toBe(false);
  });

  it('is case-insensitive when the pattern carries the i flag', () => {
    expect(
      matchesWorkflowOrId(model('recraft-creative-upscale', 'recraft/v1/images/creativeUpscale'), /upscale/i),
    ).toBe(true);
  });

  it('returns false when neither workflow nor id matches', () => {
    expect(matchesWorkflowOrId(model('flux-1.1-pro', 'flux/v1/images/generate'), /upscale/i)).toBe(false);
  });
});
