import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostingsRepository } from '../db/postings.repository';
import { ClassifierService } from '../classifier/classifier.service';
import { AppConfigService } from '../config/app-config.service';
import { SOURCES } from '../sources/sources.module';
import { NOTIFIER, type Notifier } from '../notify/types';
import { LLM_PROVIDER, type LLMProvider } from '../classifier/providers/types';
import { applyHardFilters } from '../filters';
import type { JobSource, RawPosting } from '../types';

export interface RunSummary {
  fetched: number;
  skippedDuplicate: number;
  hardFiltered: number;
  classified: number;
  classifyErrors: number;
  notified: number;
  notifyErrors: number;
  sourceErrors: number;
}

const ZERO_SUBSCORES = {
  coreStack: { score: 0, note: 'hard filter' },
  seniority: { score: 0, note: 'hard filter' },
  domain: { score: 0, note: 'hard filter' },
  logistics: { score: 0, note: 'hard filter' },
  growth: { score: 0, note: 'hard filter' },
};

@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    private readonly repo: PostingsRepository,
    private readonly classifier: ClassifierService,
    private readonly config: AppConfigService,
    @Inject(SOURCES) private readonly sources: JobSource[],
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
  ) {}

  async run(): Promise<RunSummary> {
    const s: RunSummary = {
      fetched: 0, skippedDuplicate: 0, hardFiltered: 0, classified: 0,
      classifyErrors: 0, notified: 0, notifyErrors: 0, sourceErrors: 0,
    };

    for (const source of this.sources) {
      let postings: RawPosting[];
      try {
        postings = await source.listPostings();
        await this.repo.logRun(source.id, 'ok', postings.length);
      } catch (err) {
        s.sourceErrors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`source ${source.id} failed: ${msg}`);
        await this.repo.logRun(source.id, 'error', 0, msg);
        continue;
      }

      for (const posting of postings) {
        s.fetched += 1;

        // Always upsert so last_seen advances, but decide on the score row:
        // a posting whose classification threw has none, and must be retried.
        await this.repo.upsert(posting);
        if (await this.repo.hasScore(posting.id)) { s.skippedDuplicate += 1; continue; }

        const filter = applyHardFilters(posting, this.config.profile);
        if (!filter.passed) {
          s.hardFiltered += 1;
          await this.repo.insertScore(posting.id, {
            total: 0, verdict: 'NO', subscores: ZERO_SUBSCORES,
            reasoning: `hard-filter:${filter.rule}`,
            providerId: 'hard-filter', settingsVersion: this.config.rubric.version,
          });
          continue;
        }

        try {
          await this.repo.insertScore(posting.id, await this.classifier.classify(posting));
          s.classified += 1;
        } catch (err) {
          s.classifyErrors += 1;
          this.log.warn(`classify failed for ${posting.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    await this.dispatchNotifications(s);
    return s;
  }

  private async dispatchNotifications(s: RunSummary): Promise<void> {
    const threshold = this.config.notifyThresholdFor(this.provider.id);
    const pending = await this.repo.pendingNotifications(threshold, this.notifier.channel);

    for (const item of pending) {
      try {
        await this.notifier.send(item);
        await this.repo.recordNotification(item.scoreId, this.notifier.channel);
        s.notified += 1;
      } catch (err) {
        s.notifyErrors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`notify failed for score ${item.scoreId}: ${msg}`);
        await this.repo.recordNotification(item.scoreId, this.notifier.channel, msg);
      }
    }
  }
}
