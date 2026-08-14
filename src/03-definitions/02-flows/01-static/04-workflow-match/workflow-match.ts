/**
 * workflow-match — small helper for flow predicates that need to
 * discriminate models by backend workflow.
 *
 * SDK 5 replaced the old `toolId` mapping tree with a flat
 * `workflow: string` on every model (e.g. `'recraft/v1/images/vectorize'`,
 * `'pcp/v2/sod'`). Flow predicates ask "is this an upscaler?" by running a
 * regex against it.
 *
 * The model id participates too: some vendors reuse one workflow for
 * several operations (every seedance edit/extend variant ships workflow
 * `"seedance"`), so the workflow alone can't always discriminate — the
 * id (`seedance-2.0-video-extend`) can.
 *
 * Pure function. No deps inside the block.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';

export function matchesWorkflowOrId(model: ModelDefinition, pattern: RegExp): boolean {
  return pattern.test(model.workflow) || pattern.test(model.id);
}
