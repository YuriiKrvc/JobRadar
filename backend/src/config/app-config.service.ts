import { Injectable } from '@nestjs/common';
import { loadConfig } from './load';
import type { AppConfig, Profile, Rubric, SourcesConfig } from './schema';

@Injectable()
export class AppConfigService {
  private readonly cfg: AppConfig;

  constructor() {
    this.cfg = loadConfig(process.env.CONFIG_DIR ?? '/config');
  }

  get cv(): string { return this.cfg.cv; }
  get profile(): Profile { return this.cfg.profile; }
  get rubric(): Rubric { return this.cfg.rubric; }
  get sources(): SourcesConfig { return this.cfg.sources; }

  /**
   * Scores from different models are not comparable, so the notify threshold is
   * settable per provider: NOTIFY_THRESHOLD_<SANITISED_PROVIDER_ID> beats the
   * global NOTIFY_THRESHOLD, which defaults to 50.
   */
  notifyThresholdFor(providerId: string): number {
    const key = `NOTIFY_THRESHOLD_${providerId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    return Number(process.env[key] ?? process.env.NOTIFY_THRESHOLD ?? 50);
  }
}
