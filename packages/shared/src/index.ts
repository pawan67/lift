export * from './ids.ts';
export * from './types.ts';
export * from './units.ts';
export * from './dates.ts';
export * from './calculations.ts';
export * from './ai/index.ts';
export * from './coach.ts';
export * from './landmarks.ts';
export * from './progression.ts';
export * from './measurements.ts';
export * from './ordering.ts';
export * from './plates.ts';
export * from './supersets.ts';
export * from './sync.ts';
export * from './warmup.ts';

// The exercise catalog is deliberately *not* re-exported here. It is ~6,800
// rows of generated data, and a barrel export pulled it into the module graph
// of every screen that wanted a unit conversion or a colour token. It has its
// own entry point instead: `@lift/shared/exercises`, declared in this package's
// exports map. Two files need it: the seeder and the exercise repository.
