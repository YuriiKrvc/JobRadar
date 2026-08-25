import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from './db/db.module';
import { ApiModule } from './api/api.module';
import { corsConfigFrom } from './cors';

// This module deliberately does not import AppModule: the API never
// classifies, never notifies, and must not require ANTHROPIC_API_KEY to boot.
@Module({ imports: [DatabaseModule, ApiModule] })
class ApiRoot {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiRoot);
  app.enableShutdownHooks();

  // The dashboard is deployed to its own server, so browser requests are
  // cross-origin and CORS_ORIGIN is what permits them. Unset means CORS off,
  // which is correct for deployments with no browser client.
  const cors = corsConfigFrom(process.env.CORS_ORIGIN);
  if (cors) app.enableCors(cors);

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);
  Logger.log(
    JSON.stringify({ event: 'api.started', port, corsOrigin: cors?.origin ?? null }),
  );
}

void bootstrap();
