import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { toSourceSpecs } from './to-source-specs';
import { ProfileSchema, type AppSettings } from './schema';

@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  /**
   * One read per pipeline run. Returning a plain snapshot rather than a live
   * service means a run can never observe settings changing under it, and the
   * next tick picks up an edit with no restart.
   */
  async load(): Promise<AppSettings> {
    const [row, sourceRows] = await Promise.all([
      this.repo.readRow(),
      this.repo.listSources(),
    ]);

    return {
      cv: row.cv,
      rubric: {
        version: String(row.version),
        body: row.rubricBody,
        weights: row.rubricWeights,
      },
      // Lenient parse, not a straight jsonb read: a row written before the
      // blocked-word fields existed has no such keys, and this is the one
      // place a legacy shape reaches the runtime. ProfileSchema's defaults
      // fill them in so matchBlockedWord never sees undefined.
      profile: ProfileSchema.parse(row.profile),
      sources: toSourceSpecs(sourceRows),
    };
  }
}
