import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODELS, type Effort, type ModelId, type Usage } from "@/lib/core/pricing";
import { logModelCall } from "./log";

export type { Effort };

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

interface BaseCall {
  projectId: string;
  phaseId?: string | null;
  purpose: string;
  model: ModelId;
  system?: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
  /**
   * Tried once when the primary model fails with an overload-class error
   * (429/5xx/529/connection) after the SDK's own retries are exhausted.
   * Both attempts are metered — the failed primary logs an error row.
   */
  fallbackModel?: ModelId;
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

/** Thinking/effort params only for models that accept them (Haiku 4.5 rejects both). */
function tuningParams(model: ModelId, effort: Effort) {
  const caps = MODELS[model];
  return {
    ...(caps.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
    ...(caps.effort ? { output_config: { effort } } : {}),
  };
}

function toUsage(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    webSearchRequests: u.server_tool_use?.web_search_requests ?? 0,
  };
}

function addUsage(into: Usage, u: Anthropic.Usage): void {
  const add = toUsage(u);
  into.inputTokens += add.inputTokens;
  into.outputTokens += add.outputTokens;
  into.cacheReadInputTokens =
    (into.cacheReadInputTokens ?? 0) + (add.cacheReadInputTokens ?? 0);
  into.cacheCreationInputTokens =
    (into.cacheCreationInputTokens ?? 0) + (add.cacheCreationInputTokens ?? 0);
  into.webSearchRequests = (into.webSearchRequests ?? 0) + (add.webSearchRequests ?? 0);
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

/** Overload-class error: worth one attempt on the fallback model. */
function isOverloadError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return status === 429 || status >= 500;
  }
  return false;
}

/**
 * Router fallback (P3): run the attempt on the primary model; on an
 * overload-class failure, run it once more on call.fallbackModel.
 */
async function withModelFallback<T>(
  call: BaseCall,
  attempt: (model: ModelId) => Promise<T>,
): Promise<T> {
  try {
    return await attempt(call.model);
  } catch (err) {
    const fallback = call.fallbackModel;
    if (!fallback || fallback === call.model || !isOverloadError(err)) throw err;
    console.warn(
      `gateway: ${call.model} failed for '${call.purpose}' — falling back to ${fallback}`,
    );
    return attempt(fallback);
  }
}

/**
 * Free-form text generation. Always streams internally (safe for large
 * max_tokens) and returns the final message.
 */
export async function generateText(call: BaseCall): Promise<TextResult> {
  return withModelFallback(call, async (model) => {
    const { result, usage, costUsd } = await metered({ ...call, model }, async () => {
      const stream = getClient().messages.stream({
        model,
        max_tokens: call.maxTokens ?? 16000,
        ...tuningParams(model, call.effort ?? "high"),
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
  });
}

export interface SearchTextResult extends TextResult {
  /** Unique cited sources, in citation order. */
  sources: { url: string; title: string }[];
  /** Server-side web searches executed (each billed — see pricing.ts). */
  searches: number;
}

const MAX_PAUSE_CONTINUATIONS = 5;

/**
 * Text generation with the web_search server tool (P3). The API runs the
 * searches server-side; we only continue the turn when the server-side
 * loop pauses (stop_reason "pause_turn") and account every search into
 * the metered cost. Search results are data, not instructions — the
 * system prompt owns behavior (PLAN §9).
 */
export async function generateTextWithSearch(
  call: BaseCall & { maxSearches?: number },
): Promise<SearchTextResult> {
  return withModelFallback(call, async (model) => {
    const { result, usage, costUsd } = await metered({ ...call, model }, async () => {
      const client = getClient();
      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: call.prompt },
      ];
      const total: Usage = { inputTokens: 0, outputTokens: 0 };
      const contents: Anthropic.ContentBlock[][] = [];

      // pause_turn = the server-side tool loop hit its iteration limit;
      // append the assistant turn as-is and re-send to resume.
      for (let continuations = 0; ; continuations++) {
        const stream = client.messages.stream({
          model,
          max_tokens: call.maxTokens ?? 16000,
          ...tuningParams(model, call.effort ?? "high"),
          ...(call.system ? { system: call.system } : {}),
          tools: [
            {
              type: "web_search_20260209",
              name: "web_search",
              max_uses: call.maxSearches ?? 8,
            },
          ],
          messages,
        });
        const message = await stream.finalMessage();
        addUsage(total, message.usage);
        contents.push(message.content);
        if (
          message.stop_reason !== "pause_turn" ||
          continuations >= MAX_PAUSE_CONTINUATIONS
        ) {
          break;
        }
        messages.push({ role: "assistant", content: message.content });
      }

      const blocks = contents.flat();
      const text = blocks
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const seen = new Set<string>();
      const sources: SearchTextResult["sources"] = [];
      for (const b of blocks) {
        if (b.type !== "text" || !b.citations) continue;
        for (const c of b.citations) {
          if (c.type !== "web_search_result_location" || seen.has(c.url)) continue;
          seen.add(c.url);
          sources.push({ url: c.url, title: c.title ?? c.url });
        }
      }
      return { result: { text, sources }, usage: total };
    });
    return {
      text: result.text,
      sources: result.sources,
      searches: usage.webSearchRequests ?? 0,
      usage,
      costUsd,
    };
  });
}

/**
 * Schema-enforced generation via native structured outputs. The API
 * guarantees the response validates against the Zod schema — no
 * retry-on-schema-error loop needed (PLAN §0.4).
 */
export async function generateObject<S extends z.ZodType>(
  call: BaseCall & { schema: S },
): Promise<ObjectResult<z.infer<S>>> {
  return withModelFallback(call, async (model) => {
    const { result, usage, costUsd } = await metered({ ...call, model }, async () => {
      const caps = MODELS[model];
      const response = await getClient().messages.parse({
        model,
        max_tokens: call.maxTokens ?? 16000,
        ...(caps.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
        output_config: {
          ...(caps.effort ? { effort: call.effort ?? "high" } : {}),
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
  });
}
