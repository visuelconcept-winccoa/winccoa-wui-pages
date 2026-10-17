// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Saying what a prompt cost, in the user's language.
 *
 * The numbers themselves — the {@link AiUsage} shape, the arithmetic, the compact
 * token format — live in `ai-progress.ts`, next to the channel that carries them.
 * Only the two localized sentences live here, because importing them pulls the
 * translation runtime in and `ai-progress.ts` has to stay free of it (its unit test
 * imports it directly).
 */
import { AI_MSG, localize } from '../i18n.js';
import { formatTokens, type AiUsage } from './ai-progress.js';

/** The one-line form: the total, then the split that explains it. */
export function usageLabel(usage: AiUsage): string {
  return localize(AI_MSG.usageTokens)
    .replace('%t', formatTokens(usage.tokensIn + usage.tokensOut))
    .replace('%i', formatTokens(usage.tokensIn))
    .replace('%o', formatTokens(usage.tokensOut));
}

/** The tooltip: what the total is made of — rounds, and the cheap cached part. */
export function usageDetail(usage: AiUsage): string {
  return localize(AI_MSG.usageDetail)
    .replace('%r', String(usage.rounds))
    .replace('%c', formatTokens(usage.tokensCached));
}
