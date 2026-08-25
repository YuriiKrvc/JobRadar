import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { ClassifierModule } from '../classifier/classifier.module';
import { SourcesModule } from '../sources/sources.module';
import { NotifyModule } from '../notify/notify.module';
import { PostingsRepository } from '../db/postings.repository';

@Module({
  imports: [ClassifierModule, SourcesModule, NotifyModule],
  providers: [PipelineService, PostingsRepository],
  exports: [PipelineService],
})
export class PipelineModule {}
