import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PipelineService } from './pipeline/pipeline.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  try {
    const summary = await app.get(PipelineService).run();
    Logger.log(JSON.stringify({ event: 'run.complete', ...summary }));
  } finally {
    // Closes the app, which fires DatabaseModule.onApplicationShutdown and ends
    // the postgres pool — without this the process hangs instead of exiting.
    await app.close();
  }
}

void main();
