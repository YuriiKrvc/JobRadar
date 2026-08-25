import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LLM_PROVIDER } from './classifier.module';
import type { LLMProvider } from './providers/types';
import { RawVerdictSchema, VERDICT_JSON_SCHEMA, type RawVerdict } from './schema';
import { buildPrompt } from './prompt';
import { toVerdict, weightedTotal } from './rubric';
import type { FitVerdict, RawPosting } from '../types';

export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in response');
  return JSON.parse(candidate.slice(start, end + 1));
}

function parse(raw: string): RawVerdict {
  return RawVerdictSchema.parse(extractJson(raw));
}

@Injectable()
export class ClassifierService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
    private readonly config: AppConfigService,
  ) {}

  async classify(posting: RawPosting): Promise<FitVerdict> {
    const { system, user } = buildPrompt({
      cv: this.config.cv,
      profile: this.config.profile,
      rubric: this.config.rubric,
      posting,
    });

    let parsed: RawVerdict;
    try {
      const first = await this.provider.complete({ system, user, schema: VERDICT_JSON_SCHEMA });
      parsed = parse(first.raw);
    } catch (firstError) {
      const detail = firstError instanceof Error ? firstError.message : String(firstError);
      const repairUser = [
        user,
        '',
        'Your previous response was invalid and could not be parsed.',
        `Error: ${detail}`,
        'Reply with only the JSON object required by the schema. No prose, no code fences.',
      ].join('\n');

      try {
        const second = await this.provider.complete({ system, user: repairUser, schema: VERDICT_JSON_SCHEMA });
        parsed = parse(second.raw);
      } catch (secondError) {
        const d2 = secondError instanceof Error ? secondError.message : String(secondError);
        throw new Error(
          `Classifier response failed schema validation twice (${this.provider.id}): ${d2}`,
        );
      }
    }

    const total = weightedTotal(parsed.subscores);
    return {
      total,
      verdict: toVerdict(total),
      subscores: parsed.subscores,
      reasoning: parsed.summary,
      providerId: this.provider.id,
      rubricVersion: this.config.rubric.version,
    };
  }
}
