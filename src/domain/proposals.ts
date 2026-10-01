// Agents prepare, humans confirm. A proposal is an agent's request for a trust/money decision
// (approve a partner, approve a held basket, issue a credit note). Only a signed-in person can confirm
// it; confirming executes the action as that person. (Seam for MoltenRock HumanQueue / Touch ID.)

import type { Actor, Env } from '../lib/env';
import { AppError } from '../lib/http';
import { all, audit, now, one, run } from './db';
import { creditNote, getInvoice } from './invoices';
import { decideHeldOrder, getOrder } from './orders';
import { decidePartner, getPartner } from './partners';
import { getTier } from './tiers';

export type ProposalKind = 'partner_decision' | 'basket_decision' | 'credit_note';
export interface ProposalRow { id: number; kind: ProposalKind; target_id: number; payload: string; reason: string; proposed_by: string; status: string; decided_by: string | null; decided_at: number | null; result: string | null; created_at: number }

export async function createProposal(env: Env, actor: Actor, kind: ProposalKind, targetId: number, payload: Record<string, unknown>, reason: string): Promise<ProposalRow> {
  if (actor.type !== 'agent') throw new AppError('INVALID', 'Proposals are made by agents; people decide directly on the Approvals page.');
  if (!reason?.trim()) throw new AppError('REQUIRED', 'Give a short reason the owner will read.');
  if (kind === 'partner_decision') {
    const p = await getPartner(env.DB, targetId);
    if (!p) throw new AppError('NOT_FOUND', `Partner ${targetId} not found`, 404);
    if (!['approve', 'reject', 'suspend'].includes(payload.decision as string)) throw new AppError('INVALID', "decision must be 'approve', 'reject' or 'suspend'");
    if (payload.tier_id !== undefined && !(await getTier(env.DB, Number(payload.tier_id)))) throw new AppError('NOT_FOUND', `Tier ${payload.tier_id} not found`, 404);
  } else if (kind === 'basket_decision') {
    const o = await getOrder(env.DB, targetId);
    if (!o) throw new AppError('NOT_FOUND', `Order ${targetId} not found`, 404);
    if (o.state !== 'awaiting_approval') throw new AppError('NOT_HELD', `Order is ${o.state}, not awaiting approval.`, 409);
    if (!['approve', 'reject'].includes(payload.decision as string)) throw new AppError('INVALID', "decision must be 'approve' or 'reject'");
  } else {
    const inv = await getInvoice(env.DB, targetId);
    if (!inv || inv.kind !== 'invoice') throw new AppError('NOT_FOUND', `Invoice ${targetId} not found`, 404);
    if (inv.status === 'credited') throw new AppError('ALREADY_CREDITED', 'This invoice already has a credit note.', 409);
  }
  // A newer proposal about the same thing replaces the older open one.
  await run(env.DB, "UPDATE proposals SET status = 'superseded' WHERE kind = ? AND target_id = ? AND status = 'open'", kind, targetId);
  const res = await run(env.DB, "INSERT INTO proposals (kind, target_id, payload, reason, proposed_by, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)",
    kind, targetId, JSON.stringify(payload), reason.trim().slice(0, 500), `agent:${actor.label}`, now());
  const row = (await one<ProposalRow>(env.DB, 'SELECT * FROM proposals WHERE id = ?', res.meta.last_row_id)) as ProposalRow;
  await audit(env.DB, actor, 'proposal.create', `proposal:${row.id}`, { kind, target_id: targetId, ...payload });
  return row;
}

export const listProposals = (db: D1Database, status = 'open') => all<ProposalRow>(db, 'SELECT * FROM proposals WHERE status = ? ORDER BY id DESC LIMIT 200', status);

export async function decideProposal(env: Env, actor: Actor, id: number, decision: 'confirm' | 'reject', baseUrl: string): Promise<ProposalRow> {
  if (actor.type !== 'user') throw new AppError('HUMAN_ONLY', 'Only a signed-in person can confirm proposals.', 403);
  const p = await one<ProposalRow>(env.DB, 'SELECT * FROM proposals WHERE id = ?', id);
  if (!p || p.status !== 'open') throw new AppError('NOT_OPEN', 'This proposal is no longer open.', 409);
  let result: unknown = null;
  if (decision === 'confirm') {
    const payload = JSON.parse(p.payload) as { decision?: string; tier_id?: number };
    if (p.kind === 'partner_decision') result = await decidePartner(env, actor, p.target_id, payload.decision as 'approve', payload.tier_id ?? null, baseUrl);
    else if (p.kind === 'basket_decision') result = await decideHeldOrder(env, actor, p.target_id, payload.decision as 'approve', p.reason, baseUrl);
    else result = await creditNote(env, actor, p.target_id, p.reason);
  }
  await run(env.DB, 'UPDATE proposals SET status = ?, decided_by = ?, decided_at = ?, result = ? WHERE id = ? AND status = ?',
    decision === 'confirm' ? 'confirmed' : 'rejected', actor.label, now(), JSON.stringify(result ? { ok: true } : null), id, 'open');
  await audit(env.DB, actor, `proposal.${decision}`, `proposal:${id}`, { kind: p.kind, target_id: p.target_id });
  return (await one<ProposalRow>(env.DB, 'SELECT * FROM proposals WHERE id = ?', id)) as ProposalRow;
}
