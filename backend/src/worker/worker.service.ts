import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PipelineService } from '../pipeline/pipeline.service';

@Injectable()
export class WorkerService {
  private readonly log = new Logger(WorkerService.name);
  private running = false;

  constructor(private readonly pipeline: PipelineService) {}

  @Cron(process.env.CRON_SCHEDULE ?? '*/30 * * * *', { name: 'pipeline' })
  async tick(): Promise<void> {
    if (this.running) {
      this.log.warn('run skipped: previous run still active');
      return;
    }
    this.running = true;
    try {
      const summary = await this.pipeline.run();
      this.log.log(JSON.stringify({ event: 'run.complete', ...summary }));
    } catch (err) {
      // A thrown pipeline must never kill the scheduler.
      this.log.error(JSON.stringify({
        event: 'run.failed',
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      this.running = false;
    }
  }
}
