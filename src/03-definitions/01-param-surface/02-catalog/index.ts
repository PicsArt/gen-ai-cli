/** Public API of the Catalog sub-part. */
export {
  type Catalog,
  getCatalog,
  type LoadCatalogOptions,
  loadCatalog,
  type MergedDescriptor,
  type ModelLike,
  mergeDescriptors,
  ParamConflictError,
  type ParamSurface,
  type ParamSurfaceConflict,
} from './catalog.ts';
