import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './db/db.module';
import { PipelineModule } from './pipeline/pipeline.module';

/** Shared by every entrypoint; HTTP and scheduling are layered on top. */
@Module({
  imports: [AppConfigModule, DatabaseModule, PipelineModule],
  exports: [PipelineModule],
})
export class AppModule {}
