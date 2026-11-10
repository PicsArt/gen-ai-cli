/**
 * Ids of the catalog installed into the SDK — every model, deprecated
 * included, which the SDK's own `catalog.all()` hides. A leaf module (no
 * imports) so test setup can record the snapshot it installs without loading
 * the CLI's services ahead of the suites' `vi.mock`s. Written only by
 * `sdk-catalog.ts` (`installCatalogBody`) and that setup.
 */
let _ids: readonly string[] | null = null;

export function setInstalledCatalogIds(ids: readonly string[] | null): void {
  _ids = ids;
}

export function installedCatalogIds(): readonly string[] | null {
  return _ids;
}
