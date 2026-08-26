import type { SourceSpec } from '../settings/schema';
import type { JobSource } from '../types';
import { createCustomSource } from './custom';

/**
 * One adapter per spec. Per-spec rather than per-run because the pipeline needs
 * each source's own blocklists alongside its adapter, and zipping two arrays by
 * index to recover that pairing is a bug waiting to happen.
 */
export function buildSource(spec: SourceSpec): JobSource {
  return createCustomSource(spec);
}
