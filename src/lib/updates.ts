// "Is there a newer MoltenRock Trade?" Once a day (cron) the portal fetches a tiny public JSON file
// — by default https://moltenrocktrade.com/version.json — and remembers the answer. Nothing about the
// shop is sent: it is a plain GET. The owner (or their agent) can switch it off: setting update_check.

import { VERSION } from '../version';
import type { Env } from './env';

export const DEFAULT_UPDATE_URL = 'https://moltenrocktrade.com/version.json';
const DAY = 86_400_000;

export interface LatestInfo { latest: string; released?: string; notes_url?: string; how_to_update_url?: string; checked_at: number }
export interface UpdateInfo { current: string; latest: LatestInfo | null; available: boolean }

/** Compare dotted versions numerically ("0.10.0" > "0.9.3"). Returns 1, 0 or -1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Parse and sanity-check the published file; anything unexpected is ignored. */
export function parseLatest(json: unknown, checkedAt: number): LatestInfo | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (typeof j.latest !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(j.latest)) return null;
  const url = (u: unknown) => (typeof u === 'string' && /^https:\/\/[^\s<>"]+$/.test(u) && u.length < 300 ? u : undefined);
  return { latest: j.latest.replace(/^v/, ''), released: typeof j.released === 'string' ? j.released.slice(0, 10) : undefined,
    notes_url: url(j.notes_url), how_to_update_url: url(j.how_to_update_url), checked_at: checkedAt };
}

export async function storedLatest(env: Env): Promise<LatestInfo | null> {
  const row = await env.DB.prepare("SELECT value FROM _mt_meta WHERE name = 'latest_version'").first<{ value: string }>().catch(() => null);
  if (!row) return null;
  try { return JSON.parse(row.value) as LatestInfo; } catch { return null; }
}

export async function updateInfo(env: Env): Promise<UpdateInfo> {
  const latest = await storedLatest(env);
  return { current: VERSION, latest, available: !!latest && compareVersions(latest.latest, VERSION) > 0 };
}

/** Fetch the published version (at most once a day unless forced). Failures are silent. */
export async function checkForUpdates(env: Env, opts: { force?: boolean } = {}): Promise<LatestInfo | null> {
  const prev = await storedLatest(env);
  if (!opts.force && prev && Date.now() - prev.checked_at < DAY - 3_600_000) return prev;
  try {
    const res = await fetch(env.UPDATE_URL || DEFAULT_UPDATE_URL, { headers: { Accept: 'application/json', 'User-Agent': `moltenrock-trade/${VERSION}` }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return prev;
    const info = parseLatest(await res.json(), Date.now());
    if (!info) return prev;
    await env.DB.prepare(`INSERT INTO _mt_meta (name, value, updated_at) VALUES ('latest_version', ?, ?)
      ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(info), Date.now()).run();
    return info;
  } catch {
    return prev;
  }
}
