import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { DatabaseModule } from './db/db.module';
import { SettingsModule } from './settings/settings.module';
import { ApiModule } from './api/api.module';

const staticRoot = process.env.STATIC_ROOT?.trim();

@Module({
  imports: [
    DatabaseModule,
    SettingsModule,
    ApiModule,
    // Serving the SPA from the API means same-origin requests: no CORS layer
    // and no second container. Skipped in development, where Vite serves it.
    ...(staticRoot
      ? [ServeStaticModule.forRoot({ rootPath: staticRoot, exclude: ['/api/{*path}'] })]
      : []),
  ],
})
class ApiRoot {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiRoot);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);
  Logger.log(JSON.stringify({ event: 'api.started', port, staticRoot: staticRoot || null }));
}

void bootstrap();
