import { isbot } from 'isbot';

/**
 * Bot classification for click ingestion.
 *
 * A click's "is this a real human?" quality is determined by the request that
 * created it, so it's classified here at write time and persisted on the
 * click_events row. Downstream analytics simply read the stored flag — they
 * never re-detect (the raw request signals aren't available at read time).
 *
 * Signals, in order of authority:
 *   1. edge  — a trusted upstream (reverse proxy / CDN bot management) already
 *              classified this request as a bot. Only honored when the caller
 *              opts in (the header must come from a trusted proxy, not the
 *              client). Highest confidence.
 *   2. method — HEAD / OPTIONS requests are link probes/prefetch, never a human
 *              opening a link.
 *   3. ua    — the `isbot` user-agent database (crawlers, scrapers, monitors).
 */
export type BotReason = 'edge' | 'method' | 'ua';

export interface BotClassification {
  isBot: boolean;
  reason: BotReason | null;
}

const NON_HUMAN_METHODS = new Set(['HEAD', 'OPTIONS']);

export function classifyBot(
  userAgent: string | undefined,
  method: string | undefined,
  edgeIsBot?: boolean
): BotClassification {
  if (edgeIsBot === true) return { isBot: true, reason: 'edge' };
  if (method && NON_HUMAN_METHODS.has(method.toUpperCase())) return { isBot: true, reason: 'method' };
  if (isbot(userAgent ?? '')) return { isBot: true, reason: 'ua' };
  return { isBot: false, reason: null };
}

/**
 * Resolve the optional edge bot signal from request headers. Only trusted when
 * `TRUST_EDGE_BOT_HEADER=true` — otherwise a client could set the header to
 * mark its own clicks as bots. Deployments behind a proxy that authoritatively
 * sets (and strips client-supplied copies of) `x-lf-bot` can enable it.
 */
export function edgeBotSignal(headerValue: string | string[] | undefined): boolean | undefined {
  if (process.env.TRUST_EDGE_BOT_HEADER !== 'true') return undefined;
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (v === undefined) return undefined;
  return v === '1' || v.toLowerCase() === 'true';
}
