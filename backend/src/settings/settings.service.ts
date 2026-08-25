import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { toSourcesConfig } from './to-sources-config';
import type { AppSettings } from './schema';

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
      profile: row.profile,
      sources: toSourcesConfig(sourceRows),
    };
  }
}
