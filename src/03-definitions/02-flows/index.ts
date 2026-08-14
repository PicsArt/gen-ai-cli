/**
 * Flows — public API.
 *
 * The ONLY way another block may import from Flows. Sub-parts NOT
 * re-exported here (static steps, workflow matcher) stay private to
 * this block.
 *
 * Public surface:
 *   - STATIC_FLAG_GROUPS et al.              (static flag groups)
 *   - filterCatalog                          (model-scoped catalog view —
 *     also used by the layer-4 wizard runner)
 *   - FlowSpec / defineFlow / modelAvailable / RequiredInput
 *   - FLOWS / FlowId                         (the registry)
 *   - composeFlagsForFlow                    (FlowSpec → oclif FlagSet)
 *   - composeWizardForFlow                   (FlowSpec → WizardStep[])
 */
export * from './01-static/01-static-flags/index.ts';
export * from './01-static/03-catalog-filter/index.ts';
export * from './02-registry/01-flow-spec/index.ts';
export * from './02-registry/02-flows/index.ts';
export * from './03-compose/01-flag-set/index.ts';
export * from './03-compose/02-wizard-flow/index.ts';
