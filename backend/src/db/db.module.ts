import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { closeDb, createDb, type Database } from './client';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Database => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('Missing required environment variable: DATABASE_URL');
        return createDb(url);
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Nest calls this on SIGTERM once enableShutdownHooks() is on, which is what
  // lets `once` exit instead of hanging on an open pool.
  async onApplicationShutdown(): Promise<void> {
    await closeDb(this.db);
  }
}
