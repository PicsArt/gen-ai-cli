/**
 * Flows — public API.
 *
 * The ONLY way another block may import from Flows. Internal sub-parts
 * (static flags/steps, catalog filter, tool-id matcher) stay private to
 * this block.
 *
 * Public surface:
 *   - FlowSpec / defineFlow / RequiredInput (type + helper)
 *   - FLOWS / FlowId                        (the registry)
 *   - composeFlagsForFlow                   (FlowSpec → oclif FlagSet)
 *   - composeWizardForFlow                  (FlowSpec → WizardStep[])
 */
export * from './01-static/01-static-flags/index.ts';
export * from './01-static/03-catalog-filter/index.ts';
export * from './02-registry/01-flow-spec/index.ts';
export * from './02-registry/02-flows/index.ts';
export * from './03-compose/01-flag-set/index.ts';
export * from './03-compose/02-wizard-flow/index.ts';
