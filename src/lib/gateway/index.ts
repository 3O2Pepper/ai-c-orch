/**
 * The ONLY path to a model (PLAN §3). All calls are metered via logModelCall.
 * Sampling params are not exposed — they 400 on current models.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  computeCostUsd,
  type ModelId,
  MODEL_ROUTES,
} from "@/lib/core/pricing";
import type { PhaseType } from "@/lib/core/spec";
import { logModelCall } from "./log";

export class SamplingParamsNotAllowedError extends Error {
  constructor() {
    super(
      "Sampling parameters (temperature, top_p, top_k) are not supported on current models",
    );
    this.name = "SamplingParamsNotAllowedError";
  }
}

export interface GenerateContext {
  projectId: string;
  phaseId?: string | null;
  purpose: string;
}

export interface GenerateOptions {
  phaseType: PhaseType;
  system?: string;
  user: string;
  maxTokens?: number;
}

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set (copy .env.example to .env.local)");
  }
  return new Anthropic({ apiKey });
}

function routeFor(phaseType: PhaseType) {
  return MODEL_ROUTES[phaseType];
}

function extractText(content: Anthropic.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractUsage(usage: Anthropic.Usage) {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function isTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("429")
  );
}

/** One retry for transport errors only (PLAN §0). */
export async function withTransportRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransportError(err)) throw err;
    return fn();
  }
}

async function recordCall(
  ctx: GenerateContext,
  model: ModelId,
  usage: typeof ZERO_USAGE,
  costUsd: number,
  latencyMs: number,
  status: "ok" | "error",
  error?: string,
) {
  await logModelCall({
    projectId: ctx.projectId,
    phaseId: ctx.phaseId,
    provider: "anthropic",
    model,
    purpose: ctx.purpose,
    usage,
    costUsd,
    latencyMs,
    status,
    error,
  });
}

/** Plain text generation (outline, draft). Draft uses generateStream. */
export async function generate(
  ctx: GenerateContext,
  opts: GenerateOptions,
): Promise<string> {
  const { model, effort } = routeFor(opts.phaseType);
  const client = createClient();
  const start = Date.now();

  try {
    const response = await withTransportRetry(() =>
      client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        thinking: { type: "adaptive" },
        output_config: { effort },
      }),
    );

    const text = extractText(response.content);
    const usage = extractUsage(response.usage);
    const costUsd = computeCostUsd(model, usage);

    await recordCall(ctx, model, usage, costUsd, Date.now() - start, "ok");
    return text;
  } catch (err) {
    await recordCall(
      ctx,
      model,
      ZERO_USAGE,
      0,
      Date.now() - start,
      "error",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/** Streamed generation for long outputs (draft phase). */
export async function generateStream(
  ctx: GenerateContext,
  opts: GenerateOptions,
): Promise<string> {
  const { model, effort } = routeFor(opts.phaseType);
  const client = createClient();
  const start = Date.now();

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 16384,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      thinking: { type: "adaptive" },
      output_config: { effort },
    });

    const response = await stream.finalMessage();
    const text = extractText(response.content);
    const usage = extractUsage(response.usage);
    const costUsd = computeCostUsd(model, usage);

    await recordCall(ctx, model, usage, costUsd, Date.now() - start, "ok");
    return text;
  } catch (err) {
    await recordCall(
      ctx,
      model,
      ZERO_USAGE,
      0,
      Date.now() - start,
      "error",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/** Structured output via messages.parse() + Zod (intake). */
export async function generateObject<T extends z.ZodType>(
  ctx: GenerateContext,
  opts: GenerateOptions & { schema: T },
): Promise<z.infer<T>> {
  const { model, effort } = routeFor(opts.phaseType);
  const client = createClient();
  const start = Date.now();

  try {
    const response = await withTransportRetry(() =>
      client.messages.parse({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        thinking: { type: "adaptive" },
        output_config: {
          effort,
          format: zodOutputFormat(opts.schema),
        },
      }),
    );

    if (response.parsed_output == null) {
      throw new Error("Model returned no parsed_output");
    }

    const usage = extractUsage(response.usage);
    const costUsd = computeCostUsd(model, usage);

    await recordCall(ctx, model, usage, costUsd, Date.now() - start, "ok");
    return response.parsed_output;
  } catch (err) {
    await recordCall(
      ctx,
      model,
      ZERO_USAGE,
      0,
      Date.now() - start,
      "error",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}
