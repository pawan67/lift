/**
 * Searching, filtering and ranking exercises, without the catalog.
 *
 * `./index.ts` re-exports these too, but importing them from there also loads
 * the ~6,800-row catalog, which a bundler cannot split away. The web app loads
 * the catalog as a chunk of its own and reaches these through this entry point
 * instead, so its pages do not each carry the catalog.
 */

export * from './matching.ts';
export * from './ranking.ts';
