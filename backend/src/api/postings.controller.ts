import { Controller, Get, Query } from '@nestjs/common';
import { DashboardQueries } from './dashboard.queries';
import { PostingFiltersSchema, type PostingFilters } from './api.schema';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller('api')
export class PostingsController {
  constructor(private readonly queries: DashboardQueries) {}

  @Get('postings')
  async postings(
    @Query(new ZodValidationPipe(PostingFiltersSchema)) filters: PostingFilters,
  ) {
    return { postings: await this.queries.latestScores(filters) };
  }

  @Get('health')
  async health() {
    return { sources: await this.queries.sourceHealth() };
  }
}
