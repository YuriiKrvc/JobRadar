import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, closeDb, type Database } from '../db/client';
import { appSettings, sources } from '../db/schema';
import { DEFAULT_WEIGHTS } from '../classifier/rubric';
import { loadConfig } from './import';
import type { FileConfig } from './schema';

export type SeedOutcome = 'seeded-from-files' | 'seeded-defaults' | 'already-present';

const DEFAULT_CV = `# Your Name

Replace this with your CV in prose. Roles, technologies you actually shipped,
and a short note on what you want to do next.
`;

const DEFAULT_RUBRIC = `Score the vacancy against the candidate CV on five dimensions, each 0-100.

- coreStack: overlap between required technologies and what the CV shows was
  actually shipped. 0 = no overlap, 50 = adjacent, 100 = direct match.
- seniority: 0 = clear mismatch either direction, 100 = exactly the right level.
- domain: familiarity with the industry or problem space.
- logistics: remote policy, timezone, location, and employment type against the
  candidate's stated constraints.
- growth: does this move the candidate toward the next step named in the CV.

For each dimension give an integer score and a one-sentence justification.
Do not compute a total. Do not recommend applying or not applying.
`;

const DEFAULT_PROFILE = {
  excludedLocations: [],
  allowedEmploymentTypes: [],
  minSalaryUsd: null,
  timezone: 'Europe/Kyiv',
  blockedTitleWords: [],
  blockedDescriptionWords: [],
};

export async function seed(db: Database, configDir: string): Promise<SeedOutcome> {
  // Probe for cv.md specifically rather than just the directory: Docker
  // creates an empty directory when a bind-mount source is missing on the
  // host (e.g. `config/` untracked and absent on a fresh clone), and an
  // empty directory must seed defaults, not throw. A directory that DOES
  // have cv.md but is missing the other required files is a genuine
  // misconfiguration and should still fail loudly via loadConfig.
  const file: FileConfig | null = existsSync(join(configDir, 'cv.md')) ? loadConfig(configDir) : null;

  // The guard and both inserts are one transaction. Split, a settings insert
  // that succeeded before a sources insert failed would leave every later run
  // returning 'already-present' and exiting 0 forever, with an upgrading
  // user's sources permanently lost behind a healthy-looking stack.
  return db.transaction(async (tx): Promise<SeedOutcome> => {
    const existing = await tx.select({ id: appSettings.id }).from(appSettings).limit(1);
    if (existing.length > 0) return 'already-present';

    await tx.insert(appSettings).values({
      cv: file?.cv ?? DEFAULT_CV,
      rubricBody: file?.rubric.body ?? DEFAULT_RUBRIC,
      // Weights never lived in rubric.md, so an upgrading install keeps exactly
      // the scoring behaviour it had.
      rubricWeights: DEFAULT_WEIGHTS,
      profile: file?.profile ?? DEFAULT_PROFILE,
    });

    if (file) {
      const rows = [
        ...file.sources.ats.map((a) => ({ kind: 'ats' as const, board: a.board, slug: a.slug })),
        ...file.sources.djinni.map((url) => ({ kind: 'djinni' as const, url })),
        ...file.sources.dou.map((url) => ({ kind: 'dou' as const, url })),
      ];
      if (rows.length > 0) {
        await tx.insert(sources).values(rows).onConflictDoNothing();
      }
    }

    return file ? 'seeded-from-files' : 'seeded-defaults';
  });
}

// Entrypoint for the `migrate` compose service. Guarded so importing this
// module from a test does not connect or exit the process.
if (require.main === module) {
  void (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Missing required environment variable: DATABASE_URL');
    const db = createDb(url);
    try {
      const outcome = await seed(db, process.env.CONFIG_DIR ?? '/config');
      console.log(JSON.stringify({ event: 'settings.seed', outcome }));
    } finally {
      await closeDb(db);
    }
  })();
}
