import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerModule } from './worker/worker.module';
import { WorkerService } from './worker/worker.service';

@Module({ imports: [AppModule, WorkerModule] })
class WorkerRoot {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerRoot);
  app.enableShutdownHooks();

  Logger.log(JSON.stringify({
    event: 'worker.started',
    schedule: process.env.CRON_SCHEDULE ?? '*/30 * * * *',
  }));

  // Run once at boot so a restart does not wait a full interval.
  await app.get(WorkerService).tick();
}

void bootstrap();
