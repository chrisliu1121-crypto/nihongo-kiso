// scripts/lib/ai/errors.ts — typed error for a per-word AI provider failure
// (code review item 1, P0). Providers (openrouter.ts/claude.ts) used to call
// process.exit(2) directly on any mid-call failure (401/other HTTP errors,
// network errors, schema-validation failures, truncated output,
// refusal/content-filter). Since generate-daily.ts's enrich loop runs
// BEFORE any writePending() call, a mid-batch failure left nothing on disk
// for a human to review -- a cron failure was completely
// silent/undiagnosable.
//
// Providers now throw AiProviderError instead for exactly those per-call
// cases, so generate-daily.ts/cross-check.ts can catch it per word, record
// the failure into pipeline.errors, and keep going -- writing whatever DID
// succeed to data/pending/<date>.json instead of losing the whole batch.
//
// Exception (unchanged, deliberately NOT covered by this class): the
// "missing OPENROUTER_API_KEY" / "missing ANTHROPIC_API_KEY" check that
// happens before any network call at all is a local misconfiguration, not a
// per-word failure -- it still calls process.exit(2) directly, exactly as
// before. A pending-file retry can't fix "there is no key at all".

/** What kind of failure this was, one call away from an actual network/API layer. Deliberately a small closed set -- callers (generate-daily.ts/cross-check.ts) branch on it, so it stays exhaustively checkable. */
export type AiProviderErrorKind = "auth" | "http" | "network" | "schema" | "truncated" | "refusal";

export class AiProviderError extends Error {
  readonly provider: string;
  readonly kind: AiProviderErrorKind;
  readonly detail: string;
  readonly status?: number;

  constructor(provider: string, kind: AiProviderErrorKind, detail: string, status?: number) {
    super(`[${provider}] ${kind}：${detail}`);
    this.name = "AiProviderError";
    this.provider = provider;
    this.kind = kind;
    this.detail = detail;
    this.status = status;
  }
}
