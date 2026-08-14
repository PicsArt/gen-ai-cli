/**
 * Architecture rules for the numbered-layer layout (see package.json
 * "check:arch"). Each tier may only import from lower-numbered tiers:
 *
 *   01-infrastructure → (nothing above)
 *   02-services       → 01
 *   03-definitions    → 01, 02
 *   04-pipeline       → 01, 02, 03
 *   05-shells         → 01, 02, 03, 04
 *   src root files (index, base-command, deps, types, commands-manifest,
 *   bundle-entry, compile-entry) sit on top and may import anything.
 *
 * Type-only imports of the shared contracts (src/types.ts, src/deps.ts)
 * are allowed from any layer — they carry no runtime dependency.
 */

/** Root-level modules that carry runtime application wiring. */
const ROOT_WIRING = '^src/(commands-manifest|base-command|index|bundle-entry|compile-entry)\\.ts$';

function layerRule(name, fromPath, forbiddenLayers) {
  return {
    name,
    comment: `${name}: numbered layers may only depend on lower-numbered layers`,
    severity: 'error',
    from: { path: fromPath },
    to: {
      path: [`^src/(${forbiddenLayers.join('|')})`, ROOT_WIRING],
      dependencyTypesNot: ['type-only'],
    },
  };
}

module.exports = {
  forbidden: [
    layerRule('layer-01-upward', '^src/01-infrastructure', [
      '02-services',
      '03-definitions',
      '04-pipeline',
      '05-shells',
    ]),
    layerRule('layer-02-upward', '^src/02-services', ['03-definitions', '04-pipeline', '05-shells']),
    layerRule('layer-03-upward', '^src/03-definitions', ['04-pipeline', '05-shells']),
    layerRule('layer-04-upward', '^src/04-pipeline', ['05-shells']),
    {
      name: 'no-circular',
      comment: 'Import cycles make layers meaningless and break bundling',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
