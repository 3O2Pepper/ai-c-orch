import { Sandbox } from "@e2b/code-interpreter";

// Code execution seam (P3, PLAN §8/§9): generated code NEVER runs in our
// process — it runs in an E2B cloud sandbox, or not at all. Env-gated:
// without E2B_API_KEY, sandboxConfigured() is false and callers must skip
// execution phases explicitly (recorded as events/messages), never fake a
// result.
//
// NOT YET VERIFIED against the live E2B service: E2B_API_KEY is not
// present in this environment. The adapter typechecks against
// @e2b/code-interpreter 2.x; first use with a real key should run the
// Build template end-to-end once before trusting results.

export function sandboxConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

export interface SandboxRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Structured error (name: message) when execution raised, else null. */
  error: string | null;
  /** Files collected from the sandbox after the run, base64-encoded. */
  files: { path: string; contentBase64: string }[];
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run Python code in a fresh sandbox and collect the requested output
 * files. The sandbox is always killed, even on failure.
 */
export async function runPythonInSandbox(opts: {
  code: string;
  collectFiles?: string[];
  timeoutMs?: number;
}): Promise<SandboxRun> {
  if (!sandboxConfigured()) {
    throw new Error("Sandbox is not configured — set E2B_API_KEY in .env.local");
  }
  const sandbox = await Sandbox.create({
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  try {
    const execution = await sandbox.runCode(opts.code, {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    const files: SandboxRun["files"] = [];
    if (!execution.error) {
      for (const path of opts.collectFiles ?? []) {
        try {
          const bytes = await sandbox.files.read(path, { format: "bytes" });
          files.push({ path, contentBase64: Buffer.from(bytes).toString("base64") });
        } catch {
          // Missing output file is a run failure signal, not an exception:
          // the caller sees ok=true but files missing and reacts.
        }
      }
    }

    return {
      ok: !execution.error,
      stdout: execution.logs.stdout.join(""),
      stderr: execution.logs.stderr.join(""),
      error: execution.error ? `${execution.error.name}: ${execution.error.value}` : null,
      files,
    };
  } finally {
    await sandbox.kill().catch(() => {
      // best-effort teardown; sandbox self-expires via timeoutMs
    });
  }
}
