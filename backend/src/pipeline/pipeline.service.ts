import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostingsRepository } from '../db/postings.repository';
import { ClassifierService } from '../classifier/classifier.service';
import { BUILD_SOURCES, type BuildSources } from '../sources/sources.module';
import { SettingsService } from '../settings/settings.service';
import { NotifyConfig } from '../notify/notify.config';
import { NOTIFIER, type Notifier } from '../notify/types';
import { LLM_PROVIDER, type LLMProvider } from '../classifier/providers/types';
import { applyHardFilters } from '../filters';
import type { RawPosting } from '../types';
import type { AppSettings } from '../settings/schema';

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

/**
 * A fresh install has a seeded row with an empty CV and no sources. Classifying
 * against an empty CV would burn tokens producing noise, so the run is skipped
 * and the reason written to run_log, where the dashboard health panel shows it.
 */
export function incompleteReason(s: AppSettings): string | null {
  if (s.cv.trim() === '') return 'no CV';
  const enabled = s.sources.ats.length + s.sources.djinni.length + s.sources.dou.length;
  if (enabled === 0) return 'no enabled sources';
  return null;
}

@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    private readonly repo: PostingsRepository,
    private readonly classifier: ClassifierService,
    private readonly settings: SettingsService,
    private readonly notifyConfig: NotifyConfig,
    @Inject(BUILD_SOURCES) private readonly buildSources: BuildSources,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
  ) {}

  async run(): Promise<RunSummary> {
    const s: RunSummary = {
      fetched: 0, skippedDuplicate: 0, hardFiltered: 0, classified: 0,
      classifyErrors: 0, notified: 0, notifyErrors: 0, sourceErrors: 0,
    };

    // One read per tick: a run can never see settings change under it, and the
    // next tick picks up a dashboard edit with no restart.
    //
    // A read failure — an unseeded database, a degraded connection — must reach
    // run_log rather than only stderr: the health panel and the setup banner
    // are the only places a user without `docker logs` can see why nothing is
    // being scored.
    let settings: AppSettings;
    try {
      settings = await this.settings.load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`settings load failed: ${msg}`);
      await this.repo.logRun('settings', 'error', 0, msg);
      return s;
    }

    const incomplete = incompleteReason(settings);
    if (incomplete) {
      this.log.warn(`settings incomplete: ${incomplete}`);
      await this.repo.logRun('settings', 'error', 0, `settings incomplete: ${incomplete}`);
      return s;
    }

    const sources = this.buildSources(settings.sources);

    for (const source of sources) {
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

        const filter = applyHardFilters(posting, settings.profile);
        if (!filter.passed) {
          s.hardFiltered += 1;
          await this.repo.insertScore(posting.id, {
            total: 0, verdict: 'NO', subscores: ZERO_SUBSCORES,
            reasoning: `hard-filter:${filter.rule}`,
            providerId: 'hard-filter', settingsVersion: settings.rubric.version,
          });
          continue;
        }

        try {
          await this.repo.insertScore(posting.id, await this.classifier.classify(posting, settings));
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
    const threshold = this.notifyConfig.thresholdFor(this.provider.id);
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
