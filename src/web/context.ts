import type { Lang, MsgKey } from '../i18n';
import type { Env } from '../lib/env';
import type { Viewer } from '../domain/auth';
import type { Settings, Shop } from '../domain/settings';

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  baseUrl: string;
  shop: Shop | null;
  settings: Settings;
  viewer: Viewer | null;
  lang: Lang;
  t: (key: MsgKey, vars?: Record<string, string | number>) => string;
  /** Open decisions (pending partners + held orders + open proposals) — the console's Approvals badge. */
  approvals: number;
}
