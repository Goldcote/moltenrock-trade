// Swiss identifiers: UID (enterprise number), IBAN / QR-IBAN, and payment references (SCOR, QRR).

/** Normalise "CHE-123.456.788 MWST", "che123456788" … to "CHE-123.456.788". Returns null if the shape is wrong. */
export function normaliseUid(input: string): string | null {
  const digits = input.toUpperCase().replace(/\b(MWST|TVA|IVA|VAT|HR)\b/g, '').replace(/[^0-9A-Z]/g, '');
  const m = /^CHE(\d{9})$/.exec(digits);
  if (!m) return null;
  const d = m[1] as string;
  return `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}`;
}

/**
 * UID check digit (mod 11, weights 5 4 3 2 7 6 5 4 over the first 8 digits).
 * A computed check digit of 10 means the number cannot exist.
 */
export function isValidUid(input: string): boolean {
  const norm = normaliseUid(input);
  if (!norm) return false;
  const d = norm.replace(/\D/g, '').split('').map(Number);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4];
  const sum = weights.reduce((s, w, i) => s + w * (d[i] as number), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === d[8];
}

export const uidDigits = (uid: string): string => (normaliseUid(uid) ?? '').replace(/\D/g, '');

/** "CHE-123.456.788 MWST" — Swiss invoices print MWST/TVA/IVA, never "VAT". */
export function vatNumberLabel(uid: string, lang: 'de' | 'fr' | 'it' | 'en'): string {
  const suffix = lang === 'fr' ? 'TVA' : lang === 'it' ? 'IVA' : 'MWST';
  return `${normaliseUid(uid) ?? uid} ${suffix}`;
}

// ---- IBAN -------------------------------------------------------------------------------------

export const compactIban = (iban: string): string => iban.replace(/[\s-]+/g, '').toUpperCase();
export const formatIban = (iban: string): string => compactIban(iban).replace(/(.{4})/g, '$1 ').trim();

/** Convert letters to numbers (A=10 … Z=35) and compute mod 97 over the long digit string. */
function mod97(alnum: string): number {
  let rem = 0;
  for (const ch of alnum) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem;
}

/** QR-bills only allow CH and LI accounts (21 characters). */
export function isValidIban(iban: string): boolean {
  const c = compactIban(iban);
  if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(c)) return false;
  return mod97(c.slice(4) + c.slice(0, 4)) === 1;
}

/** A QR-IBAN has an institution id (IID, positions 5–9) in 30000–31999 and must be used with a QRR reference. */
export function isQrIban(iban: string): boolean {
  const iid = Number(compactIban(iban).slice(4, 9));
  return isValidIban(iban) && iid >= 30000 && iid <= 31999;
}

// ---- References -------------------------------------------------------------------------------

/** ISO 11649 creditor reference ("SCOR"): RF + 2 check digits + up to 21 alphanumerics. */
export function makeScor(body: string): string {
  const b = body.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (b.length < 1 || b.length > 21) throw new Error('SCOR body must be 1–21 alphanumerics');
  const check = 98 - mod97(b + 'RF00');
  return `RF${String(check).padStart(2, '0')}${b}`;
}

export function isValidScor(ref: string): boolean {
  const r = ref.replace(/\s+/g, '').toUpperCase();
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(r)) return false;
  return mod97(r.slice(4) + r.slice(0, 4)) === 1;
}

const QRR_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** Modulo-10 recursive check digit used by QR references (and the old ESR). */
export function mod10Recursive(digits: string): number {
  let carry = 0;
  for (const ch of digits) carry = QRR_TABLE[(carry + Number(ch)) % 10] as number;
  return (10 - carry) % 10;
}

/** 27-digit QR reference from up to 26 digits of payload (left-padded with zeros). */
export function makeQrr(payload: string): string {
  const p = payload.replace(/\D/g, '');
  if (p.length < 1 || p.length > 26) throw new Error('QRR payload must be 1–26 digits');
  const body = p.padStart(26, '0');
  return body + String(mod10Recursive(body));
}

export function isValidQrr(ref: string): boolean {
  const r = ref.replace(/\s+/g, '');
  return /^\d{27}$/.test(r) && mod10Recursive(r.slice(0, 26)) === Number(r[26]);
}

/** Swiss postcodes are 4 digits. */
export const isSwissPostcode = (pc: string): boolean => /^[1-9]\d{3}$/.test(pc.trim());
