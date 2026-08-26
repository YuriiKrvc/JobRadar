import { Module } from '@nestjs/common';
import { buildSource } from './sources.factory';
import type { JobSource } from '../types';
import type { SourceSpec } from '../settings/schema';

export type BuildSource = (spec: SourceSpec) => JobSource;

/**
 * A factory, not a prebuilt array: sources are editable at runtime, so adapters
 * are constructed per run from the current snapshot. Keeping it a DI token
 * rather than a direct import preserves the seam the pipeline tests use to
 * inject fake sources.
 */
export const BUILD_SOURCE = Symbol('BUILD_SOURCE');

@Module({
  providers: [{ provide: BUILD_SOURCE, useValue: buildSource satisfies BuildSource }],
  exports: [BUILD_SOURCE],
})
export class SourcesModule {}
