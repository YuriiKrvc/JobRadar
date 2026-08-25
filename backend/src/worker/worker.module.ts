import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkerService } from './worker.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [ScheduleModule.forRoot(), PipelineModule],
  providers: [WorkerService],
})
export class WorkerModule {}
