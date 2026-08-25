import { Injectable } from '@nestjs/common';

@Injectable()
export class NotifyConfig {
  /**
   * Scores from different models are not comparable, so the notify threshold is
   * settable per provider: NOTIFY_THRESHOLD_<SANITISED_PROVIDER_ID> beats the
   * global NOTIFY_THRESHOLD, which defaults to 50. Env only - thresholds are
   * secrets-adjacent deployment config and deliberately did not move to the DB.
   */
  thresholdFor(providerId: string): number {
    const key = `NOTIFY_THRESHOLD_${providerId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    return Number(process.env[key] ?? process.env.NOTIFY_THRESHOLD ?? 50);
  }
}
