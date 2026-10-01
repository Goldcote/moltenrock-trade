import { describe, expect, it } from 'vitest';
import { splitSql } from '../src/lib/bootstrap';
import { qrSvg } from '../src/invoice/html';
import m0001 from '../migrations/0001_init.sql';

describe('self-setup migration splitting', () => {
  const stmts = splitSql(m0001);
  it('yields complete statements (no comment-only or empty fragments)', () => {
    expect(stmts.length).toBeGreaterThan(25);
    for (const s of stmts) expect(s).toMatch(/^(CREATE|INSERT)/);
  });
  it('keeps each trigger body (with its inner semicolon) in one statement', () => {
    const triggers = stmts.filter((s) => s.startsWith('CREATE TRIGGER'));
    expect(triggers).toHaveLength(2);
    for (const tr of triggers) expect(tr).toMatch(/BEGIN SELECT RAISE\(ABORT, '[^']+'\); END$/);
  });
  it('creates every core table', () => {
    for (const t of ['shop', 'settings', 'users', 'partners', 'products', 'product_translations', 'orders', 'invoices', 'proposals', 'agent_tokens', 'audit_log'])
      expect(stmts.some((s) => s.startsWith(`CREATE TABLE ${t} (`))).toBe(true);
  });
});

describe('free-plan invoice QR code (SVG)', () => {
  it('renders an SVG with modules and the Swiss cross', () => {
    const svg = qrSvg('SPC\n0200\n1\nCH9300762011623852957').value;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path d="M');
    expect(svg.match(/<rect /g)).toHaveLength(4);
  });
});
