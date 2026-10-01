// Price tiers (decisions 4 + 5): Standard −40 % and VIP −50 % seeded; unlimited custom tiers;
// generic B2B templates (Partner −45 %, Distributor −55 %) to pick from — no industry-specific ones.

import type { Actor } from '../lib/env';
import { AppError } from '../lib/http';
import { all, audit, now, one, run } from './db';

export interface Tier { id: number; name: string; discount_bp: number; is_default: number }

export const TIER_TEMPLATES = [
  { key: 'partner', name: 'Partner', discount_bp: 4500, suggested_for: [] as string[] },
  { key: 'distributor', name: 'Distributor', discount_bp: 5500, suggested_for: [] as string[] },
] as const;

export const SEED_TIERS = [
  { name: 'Standard', discount_bp: 4000, is_default: 1 },
  { name: 'VIP', discount_bp: 5000, is_default: 0 },
];

export const listTiers = (db: D1Database) => all<Tier>(db, 'SELECT id, name, discount_bp, is_default FROM tiers ORDER BY discount_bp, id');
export const getTier = (db: D1Database, id: number) => one<Tier>(db, 'SELECT id, name, discount_bp, is_default FROM tiers WHERE id = ?', id);

export async function defaultTier(db: D1Database): Promise<Tier> {
  const t = await one<Tier>(db, 'SELECT id, name, discount_bp, is_default FROM tiers WHERE is_default = 1 ORDER BY id LIMIT 1')
    ?? await one<Tier>(db, 'SELECT id, name, discount_bp, is_default FROM tiers ORDER BY id LIMIT 1');
  if (!t) throw new AppError('NO_TIERS', 'No price tiers exist.', 409);
  return t;
}

/** A template may be SUGGESTED from an applicant's business type — never assigned automatically. */
export const suggestTemplate = (businessType: string) => TIER_TEMPLATES.find((t) => (t.suggested_for as readonly string[]).includes(businessType)) ?? null;

function checkTier(name: string | undefined, discountBp: number | undefined) {
  if (name !== undefined && !name.trim()) throw new AppError('REQUIRED', 'Tier name is required');
  if (discountBp !== undefined && (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 9900))
    throw new AppError('INVALID_DISCOUNT', 'discount_bp must be an integer 0–9900 (basis points: 4000 = 40 %)');
}

export async function createTier(db: D1Database, actor: Actor, input: { name?: string; discount_bp?: number; template?: string }): Promise<Tier> {
  const tpl = input.template ? TIER_TEMPLATES.find((t) => t.key === input.template) : null;
  if (input.template && !tpl) throw new AppError('UNKNOWN_TEMPLATE', `Unknown template. Use one of: ${TIER_TEMPLATES.map((t) => t.key).join(', ')}`);
  const name = input.name ?? tpl?.name;
  const discount = input.discount_bp ?? tpl?.discount_bp;
  checkTier(name, discount);
  if (name === undefined || discount === undefined) throw new AppError('REQUIRED', 'Give name and discount_bp, or a template');
  const res = await run(db, 'INSERT INTO tiers (name, discount_bp, is_default, created_at) VALUES (?, ?, 0, ?)', name.trim().slice(0, 60), discount, now());
  const tier = (await getTier(db, Number(res.meta.last_row_id))) as Tier;
  await audit(db, actor, 'tier.create', `tier:${tier.id}`, { name: tier.name, discount_bp: tier.discount_bp });
  return tier;
}

export async function updateTier(db: D1Database, actor: Actor, id: number, patch: { name?: string; discount_bp?: number; is_default?: boolean }): Promise<Tier> {
  const tier = await getTier(db, id);
  if (!tier) throw new AppError('NOT_FOUND', `Tier ${id} not found`, 404);
  checkTier(patch.name, patch.discount_bp);
  const stmts = [db.prepare('UPDATE tiers SET name = ?, discount_bp = ? WHERE id = ?').bind(patch.name?.trim() ?? tier.name, patch.discount_bp ?? tier.discount_bp, id)];
  if (patch.is_default) stmts.push(db.prepare('UPDATE tiers SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').bind(id));
  await db.batch(stmts);
  await audit(db, actor, 'tier.update', `tier:${id}`, patch);
  return (await getTier(db, id)) as Tier;
}
