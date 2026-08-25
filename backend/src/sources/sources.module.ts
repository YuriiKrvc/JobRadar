import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { buildSources } from './sources.factory';
import type { JobSource } from '../types';

export const SOURCES = Symbol('SOURCES');

@Module({
  providers: [
    {
      provide: SOURCES,
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService): JobSource[] => buildSources(cfg.sources),
    },
  ],
  exports: [SOURCES],
})
export class SourcesModule {}
