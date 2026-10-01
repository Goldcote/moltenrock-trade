export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEV?: string;
  APP_NAME?: string;
  // Optional: if unset, the app generates and stores its own (see lib/bootstrap.ts).
  SESSION_SECRET?: string;
  ENCRYPTION_KEY?: string;
  // Optional: only this email may create the shop (recommended for self-hosted installs).
  OWNER_EMAIL?: string;
  // Optional email sending via Resend (https://resend.com). Without it, emails go to the dev outbox
  // and sign-in/invite links are handed to the merchant (or their agent) to forward.
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  // Optional: where the daily update check looks (default https://moltenrocktrade.com/version.json).
  UPDATE_URL?: string;
  // Only used by local development to pre-fill the shop connection; never required in production.
  WOO_URL?: string;
  WOO_CONSUMER_KEY?: string;
  WOO_CONSUMER_SECRET?: string;
}

export const isDev = (env: Env): boolean => env.DEV === '1';

/** Who is acting. Every write in the domain layer takes one of these, so the audit log always knows. */
export type Actor =
  | { type: 'user'; id: number; label: string; role: 'owner' | 'staff' }
  | { type: 'partner'; id: number; partnerId: number; label: string }
  | { type: 'agent'; id: number; label: string; scope: AgentScope }
  | { type: 'system'; label: string };

export type AgentScope = 'read' | 'operate' | 'configure';

export const actorLabel = (a: Actor): string =>
  a.type === 'agent' ? `agent:${a.label}` : a.type === 'system' ? `system:${a.label}` : `${a.type}:${a.label}`;
