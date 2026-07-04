import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ModelId, Usage } from "@/lib/core/pricing";
import { logModelCall } from "./log";

// The ONLY path to a model. Every call is metered into model_calls (and
// projects.spent_usd) before its result propagates — success or failure.
// No sampling params are exposed: temperature/top_p/top_k are rejected with
// 400 on current models. Thinking is adaptive; depth is controlled via
// output_config.effort.

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set — add it to .env.local");
    }
    client = new Anthropic();
  }
  return client;
}

export type Effort = "low" | "medium" | "high";

interface BaseCall {
  projectId: string;
  phaseId?: string | null;
  purpose: string;
  model: ModelId;
  system?: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
}

export interface TextResult {
  text: string;
  usage: Usage;
  costUsd: number;
}

export interface ObjectResult<T> {
  object: T;
  usage: Usage;
  costUsd: number;
}

function toUsage(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  };
}

async function metered<T>(
  call: BaseCall,
  run: () => Promise<{ result: T; usage: Usage }>,
): Promise<{ result: T; usage: Usage; costUsd: number }> {
  const start = Date.now();
  try {
    const { result, usage } = await run();
    const cost = await logModelCall({
      projectId: call.projectId,
      phaseId: call.phaseId,
      model: call.model,
      purpose: call.purpose,
      usage,
      latencyMs: Date.now() - start,
      status: "ok",
    });
    return { result, usage, costUsd: cost };
  } catch (err) {
    await logModelCall({
      projectId: call.projectId,
      phaseId: call.phaseId,
      model: call.model,
      purpose: call.purpose,
      usage: null,
      latencyMs: Date.now() - start,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {
      // metering failure must not mask the original error
    });
    throw err;
  }
}

/**
 * Free-form text generation. Always streams internally (safe for large
 * max_tokens) and returns the final message.
 */
export async function generateText(call: BaseCall): Promise<TextResult> {
  const { result, usage, costUsd } = await metered(call, async () => {
    const stream = getClient().messages.stream({
      model: call.model,
      max_tokens: call.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: call.effort ?? "high" },
      ...(call.system ? { system: call.system } : {}),
      messages: [{ role: "user", content: call.prompt }],
    });
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { result: text, usage: toUsage(message.usage) };
  });
  return { text: result, usage, costUsd };
}

/**
 * Schema-enforced generation via native structured outputs. The API
 * guarantees the response validates against the Zod schema — no
 * retry-on-schema-error loop needed (PLAN §0.4).
 */
export async function generateObject<S extends z.ZodType>(
  call: BaseCall & { schema: S },
): Promise<ObjectResult<z.infer<S>>> {
  const { result, usage, costUsd } = await metered(call, async () => {
    const response = await getClient().messages.parse({
      model: call.model,
      max_tokens: call.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: call.effort ?? "high",
        format: zodOutputFormat(call.schema),
      },
      ...(call.system ? { system: call.system } : {}),
      messages: [{ role: "user", content: call.prompt }],
    });
    if (response.parsed_output == null) {
      throw new Error(
        `Structured output missing (stop_reason: ${response.stop_reason})`,
      );
    }
    return { result: response.parsed_output, usage: toUsage(response.usage) };
  });
  return { object: result, usage, costUsd };
}
