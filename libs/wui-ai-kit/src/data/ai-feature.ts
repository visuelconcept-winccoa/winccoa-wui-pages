/**
 * AI-assistant feature flag (deploy-time, OFF by default).
 *
 * Whether the embedded AI assistant is shown in the dashboard pages is a
 * deployment choice, not a code one. It is read from a small static file
 * `dashboard-features.json` at the dashboard root
 * (`/data/dashboard-wc/dashboard-features.json`), written by the deploy tooling
 * (`tools/scripts/deploy-release.mjs --ai-assistant`). When the file is absent,
 * unreadable, or the flag is not the boolean `true`, the assistant stays HIDDEN.
 *
 * The file is fetched once and cached; this helper never throws.
 */
const FEATURES_URL = '/data/dashboard-wc/dashboard-features.json';

let cache: Promise<Record<string, unknown>> | null = null;

/** Load (once, cached) the deployed feature flags; {} when unavailable. */
function loadFeatures(): Promise<Record<string, unknown>> {
  cache ??= fetch(FEATURES_URL)
    .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : {}))
    .catch(() => ({}));
  return cache;
}

/** True only when the deploy explicitly enabled the AI assistant (default false). */
export async function isAiAssistantEnabled(): Promise<boolean> {
  const features = await loadFeatures();
  return features['aiAssistant'] === true;
}
