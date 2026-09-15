/**
 * The pure half of the AI layer: what goes on the wire, and what the model is
 * asked for. No `fetch` and no React, so all of it is testable with `node
 * --test` like the rest of this package.
 */

export * from './advisor.ts';
export * from './briefs.ts';
export * from './messages.ts';
export * from './providers.ts';
