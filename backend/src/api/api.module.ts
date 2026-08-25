import { Module } from '@nestjs/common';
import { DashboardQueries } from './dashboard.queries';
import { HealthController } from './health.controller';
import { PostingsController } from './postings.controller';

@Module({
  controllers: [PostingsController, HealthController],
  providers: [DashboardQueries],
})
export class ApiModule {}
