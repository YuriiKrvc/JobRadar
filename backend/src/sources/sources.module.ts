import { Module } from '@nestjs/common';
import { buildSources } from './sources.factory';
import type { JobSource } from '../types';
import type { SourcesConfig } from '../settings/schema';

export type BuildSources = (cfg: SourcesConfig) => JobSource[];

/**
 * A factory, not a prebuilt array: sources are now editable at runtime, so
 * adapters must be constructed per run from the current snapshot. Keeping it a
 * DI token rather than a direct import preserves the seam the pipeline tests
 * use to inject fake sources.
 */
export const BUILD_SOURCES = Symbol('BUILD_SOURCES');

@Module({
  providers: [{ provide: BUILD_SOURCES, useValue: buildSources satisfies BuildSources }],
  exports: [BUILD_SOURCES],
})
export class SourcesModule {}
