/**
 * Param Surface — public API.
 *
 * The ONLY way another block may import from Param Surface. Internal
 * sub-parts (`01-primitives/`, `02-catalog/`, `03-describe/`,
 * `04-interpret/`, `05-audit/`) are private to this block.
 *
 * Sub-parts re-exported here:
 *   - aliases             — name overrides
 *   - coercion            — value/case helpers
 *   - catalog             — descriptor index
 *   - flag-schema         — descriptor → oclif flag set
 *   - wizard-schema       — descriptor → WizardStep[]
 *   - flag-reader         — flag values → ctx
 *   - wizard-reader       — wizard answers → ctx
 *   - audit               — drift report over the catalog
 */
export * from './01-primitives/01-aliases/index.ts';
export * from './01-primitives/02-coercion/index.ts';
export * from './02-catalog/index.ts';
export * from './03-describe/01-flag-schema/index.ts';
export * from './03-describe/02-wizard-schema/index.ts';
export * from './04-interpret/01-flag-reader/index.ts';
export * from './04-interpret/02-wizard-reader/index.ts';
export * from './05-audit/index.ts';
