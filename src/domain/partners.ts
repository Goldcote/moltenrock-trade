// Trade partners (B2B customers): apply → human approves; invited partners are approved on Standard.

import { isLang, t, type Lang } from '../i18n';
import type { Actor, Env } from '../lib/env';
import { AppError } from '../lib/http';
import { isSwissPostcode, isValidUid, normaliseUid } from '../swiss/validate';
import { createMagicLink, INVITE_LINK_TTL } from './auth';
import { all, audit, now, one, run, sendEmail } from './db';
import { getSettings, requireShop } from './settings';
import { defaultTier, getTier, suggestTemplate } from './tiers';
import { TEMPLATE_VERSION } from '../legal/templates';

export interface Partner {
  id: number; company: string; contact_name: string; email: string; phone: string;
  street: string; house_no: string; postcode: string; city: string; country: string;
  uid: string | null; uid_check: string; language: Lang; business_type: string;
  tier_id: number | null; status: 'pending' | 'approved' | 'rejected' | 'suspended'; invited: number;
  min_order_rappen: number | null; payment_terms_days: number | null; prepayment: number; trusted: number;
  created_at: number; decided_at: number | null;
  terms_accepted_at: number | null; terms_version: string | null;
}

export const BUSINESS_TYPES = ['retail', 'hotel', 'pharmacy', 'salon', 'other'] as const;

export interface PartnerInput {
  company: string; contact_name: string; email: string; phone?: string;
  street: string; house_no?: string; postcode: string; city: string;
  uid?: string; language?: string; business_type?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validatePartner(i: PartnerInput): Required<Omit<PartnerInput, 'uid'>> & { uid: string | null; language: Lang } {
  for (const k of ['company', 'contact_name', 'email', 'street', 'postcode', 'city'] as const)
    if (!i[k]?.trim()) throw new AppError('REQUIRED', `${k} is required`, 400, { field: k });
  if (!EMAIL_RE.test(i.email.trim())) throw new AppError('INVALID_EMAIL', 'Invalid email address', 400, { field: 'email' });
  if (!isSwissPostcode(i.postcode)) throw new AppError('INVALID_POSTCODE', 'Postcode must be a 4-digit Swiss postcode', 400, { field: 'postcode' });
  if (i.uid?.trim() && !isValidUid(i.uid)) throw new AppError('INVALID_UID', 'UID number fails the check digit', 400, { field: 'uid' });
  return {
    company: i.company.trim().slice(0, 120), contact_name: i.contact_name.trim().slice(0, 120), email: i.email.trim().toLowerCase(),
    phone: (i.phone ?? '').trim().slice(0, 40), street: i.street.trim().slice(0, 70), house_no: (i.house_no ?? '').trim().slice(0, 16),
    postcode: i.postcode.trim(), city: i.city.trim().slice(0, 35),
    uid: i.uid?.trim() ? normaliseUid(i.uid) : null,
    language: isLang(i.language) ? i.language : 'de',
    business_type: BUSINESS_TYPES.includes(i.business_type as never) ? (i.business_type as string) : 'other',
  };
}

async function insertPartner(db: D1Database, v: ReturnType<typeof validatePartner>, status: Partner['status'], tierId: number | null, invited: boolean): Promise<number> {
  if (await one(db, 'SELECT 1 FROM partner_users WHERE email = ?', v.email)) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists. Please sign in.', 409, { field: 'email' });
  if (await one(db, 'SELECT 1 FROM users WHERE email = ?', v.email)) throw new AppError('EMAIL_TAKEN', 'This email belongs to a merchant account.', 409, { field: 'email' });
  const ts = now();
  const res = await run(db, `INSERT INTO partners (company, contact_name, email, phone, street, house_no, postcode, city, country, uid, uid_check, language, business_type, tier_id, status, invited, terms_accepted_at, created_at, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    v.company, v.contact_name, v.email, v.phone, v.street, v.house_no, v.postcode, v.city, v.uid, v.uid ? 'format_ok' : 'unchecked',
    v.language, v.business_type, tierId, status, invited ? 1 : 0, invited ? null : ts, ts, status === 'approved' ? ts : null);
  const partnerId = Number(res.meta.last_row_id);
  await run(db, 'INSERT INTO partner_users (partner_id, email, name, created_at) VALUES (?, ?, ?, ?)', partnerId, v.email, v.contact_name, ts);
  return partnerId;
}

/** Public application → pending until a human approves it. */
export async function applyForAccount(env: Env, input: PartnerInput, termsAccepted: boolean): Promise<Partner> {
  if (!termsAccepted) throw new AppError('TERMS', 'Terms and privacy notice must be accepted', 400, { field: 'terms' });
  const shop = await requireShop(env.DB);
  const v = validatePartner(input);
  const id = await insertPartner(env.DB, v, 'pending', null, false);
  // Which terms were accepted: the merchant's own page, or the built-in template version.
  const s = await getSettings(env.DB);
  await run(env.DB, 'UPDATE partners SET terms_version = ? WHERE id = ?', s.legal_terms_url ?? TEMPLATE_VERSION, id);
  const p = (await getPartner(env.DB, id)) as Partner;
  await audit(env.DB, { type: 'partner', id, partnerId: id, label: v.email }, 'partner.apply', `partner:${id}`, { company: v.company });
  await sendEmail(env, v.email, t(v.language, 'email.applied.subject', { shop: shop.legal_name }), t(v.language, 'email.applied.body', { name: v.contact_name }));
  await sendEmail(env, shop.email, `New trade application: ${v.company}`, `${v.company} (${v.contact_name}, ${v.email}) applied. Review it under Approvals.`);
  return p;
}

/** Invited partners count as already approved (decision 1), on the default tier unless another is given. */
export async function invitePartner(env: Env, actor: Actor, input: PartnerInput & { tier_id?: number }, baseUrl: string): Promise<Partner & { invite_email_delivered: boolean; note?: string }> {
  const shop = await requireShop(env.DB);
  const v = validatePartner(input);
  const tier = input.tier_id ? await getTier(env.DB, input.tier_id) : await defaultTier(env.DB);
  if (!tier) throw new AppError('NOT_FOUND', `Tier ${input.tier_id} not found`, 404);
  const id = await insertPartner(env.DB, v, 'approved', tier.id, true);
  const link = `${baseUrl}/auth/verify?t=${await createMagicLink(env, v.email, INVITE_LINK_TTL)}`;
  const mail = await sendEmail(env, v.email, t(v.language, 'email.invited.subject', { shop: shop.legal_name }), t(v.language, 'email.invited.body', { shop: shop.legal_name, name: v.contact_name, link }));
  await audit(env.DB, actor, 'partner.invite', `partner:${id}`, { company: v.company, tier: tier.name, emailed: mail.delivered });
  return {
    ...((await getPartner(env.DB, id)) as Partner),
    invite_email_delivered: mail.delivered,
    ...(mail.delivered ? {} : { note: 'No email provider is configured, so the invitation was not emailed. The owner can create a sign-in link to forward under Approvals → Partners.' }),
  };
}

/** Approve / reject / suspend. Humans only — agents must file a proposal instead. */
export async function decidePartner(env: Env, actor: Actor, id: number, decision: 'approve' | 'reject' | 'suspend', tierId: number | null, baseUrl: string): Promise<Partner> {
  if (actor.type !== 'user') throw new AppError('HUMAN_ONLY', 'Partner decisions need a person. Agents: use propose_partner_decision.', 403);
  const p = await getPartner(env.DB, id);
  if (!p) throw new AppError('NOT_FOUND', `Partner ${id} not found`, 404);
  const shop = await requireShop(env.DB);
  if (decision === 'approve') {
    const tier = tierId ? await getTier(env.DB, tierId) : await defaultTier(env.DB);
    if (!tier) throw new AppError('NOT_FOUND', `Tier ${tierId} not found`, 404);
    await run(env.DB, "UPDATE partners SET status = 'approved', tier_id = ?, decided_at = ? WHERE id = ?", tier.id, now(), id);
    const link = `${baseUrl}/auth/verify?t=${await createMagicLink(env, p.email)}`;
    await sendEmail(env, p.email, t(p.language, 'email.approved.subject', { shop: shop.legal_name }), t(p.language, 'email.approved.body', { name: p.contact_name, link }));
  } else {
    await run(env.DB, 'UPDATE partners SET status = ?, decided_at = ? WHERE id = ?', decision === 'reject' ? 'rejected' : 'suspended', now(), id);
    if (decision === 'suspend') await run(env.DB, "DELETE FROM sessions WHERE subject_type = 'partner_user' AND subject_id IN (SELECT id FROM partner_users WHERE partner_id = ?)", id);
  }
  await audit(env.DB, actor, `partner.${decision}`, `partner:${id}`, { tier_id: tierId });
  return (await getPartner(env.DB, id)) as Partner;
}

/** Commercial terms an agent with "configure" scope may set. Trust flags stay human-only. */
export async function setPartnerTerms(db: D1Database, actor: Actor, id: number, patch: { tier_id?: number; min_order_rappen?: number | null; payment_terms_days?: number | null }): Promise<Partner> {
  const p = await getPartner(db, id);
  if (!p) throw new AppError('NOT_FOUND', `Partner ${id} not found`, 404);
  if (patch.tier_id !== undefined && !(await getTier(db, patch.tier_id))) throw new AppError('NOT_FOUND', `Tier ${patch.tier_id} not found`, 404);
  const intOrNull = (v: number | null | undefined, hi: number, name: string) => {
    if (v === undefined || v === null) return v;
    if (!Number.isInteger(v) || v < 0 || v > hi) throw new AppError('INVALID', `${name} must be an integer 0–${hi} or null`);
    return v;
  };
  await run(db, 'UPDATE partners SET tier_id = ?, min_order_rappen = ?, payment_terms_days = ? WHERE id = ?',
    patch.tier_id ?? p.tier_id,
    patch.min_order_rappen === undefined ? p.min_order_rappen : intOrNull(patch.min_order_rappen, 10_000_000, 'min_order_rappen'),
    patch.payment_terms_days === undefined ? p.payment_terms_days : intOrNull(patch.payment_terms_days, 120, 'payment_terms_days'), id);
  await audit(db, actor, 'partner.set_terms', `partner:${id}`, patch);
  return (await getPartner(db, id)) as Partner;
}

export const getPartner = (db: D1Database, id: number) => one<Partner>(db, 'SELECT * FROM partners WHERE id = ?', id);

export async function listPartners(db: D1Database, status?: string): Promise<(Partner & { tier_name: string | null; suggested_template: string | null })[]> {
  const rows = await all<Partner & { tier_name: string | null }>(db,
    `SELECT p.*, t.name AS tier_name FROM partners p LEFT JOIN tiers t ON t.id = p.tier_id ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.created_at DESC LIMIT 500`,
    ...(status ? [status] : []));
  return rows.map((r) => ({ ...r, suggested_template: r.status === 'pending' ? suggestTemplate(r.business_type)?.key ?? null : null }));
}
