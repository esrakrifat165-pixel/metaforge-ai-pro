
import {
  buildStrictPrompt,
  buildStrictSchema,
  validateStrict,
  type StrictData,
} from "../metadata/strict";
import { runProviderWithKeys } from "./runProvider";
import type { ProviderId } from "../providers/catalog";

// Maximum validation attempts per image.
const MAX_ATTEMPTS = 3;

export type StrictOutcome =
  | {
      ok: true;
      data: StrictData;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      retryable: boolean;
      retryAfterSeconds: number | null;
    };

export async function generateStrictMetadata(input: {
  userId: string;
  provider?: ProviderId;
  model: string;
  mimeType: string;
  base64: string;
  count: number;
}): Promise<StrictOutcome> {
  const provider = input.provider ?? "gemini";
  let problems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const run = await runProviderWithKeys({
      userId: input.userId,
      provider,
      model: input.model,
      mimeType: input.mimeType,
      base64: input.base64,
      prompt: buildStrictPrompt(input.count, problems),
      schema: buildStrictSchema(input.count),
      keywordMax: input.count,
    });

    if (!run.ok) {
      return {
        ok: false,
        status: run.status,
        code: run.code,
        message: run.message,
        retryable: run.retryable,
        retryAfterSeconds: run.retryAfterSeconds,
      };
    }

    const checked = validateStrict(run.raw, input.count);

    if (checked.ok) {
      const warnings =
        attempt > 1
          ? [
              ...checked.warnings,
              `Needed ${attempt} attempts to meet the metadata rules.`,
            ]
          : checked.warnings;

      return {
        ok: true,
        data: checked.data,
        warnings,
      };
    }

    problems = checked.problems;
  }

  return {
    ok: false,
    status: 502,
    code: "validation_failed",
    message:
      `The model could not meet the metadata rules after ${MAX_ATTEMPTS} attempts: ` +
      problems.join(" "),
    retryable: true,
    retryAfterSeconds: null,
  };
}
