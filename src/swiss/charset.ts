// Character-set helpers.
// QR-bill (SIX IG v2.x) accepts Basic Latin, Latin-1 Supplement, Latin Extended-A, Ș ș Ț ț and €.
// The PDF uses the standard Helvetica font, which only covers Windows-1252 (WinAnsi).

const isQrAllowed = (cp: number): boolean =>
  (cp >= 0x20 && cp <= 0x7e) ||
  (cp >= 0xa0 && cp <= 0xff) ||
  (cp >= 0x100 && cp <= 0x17f) ||
  (cp >= 0x218 && cp <= 0x21b) ||
  cp === 0x20ac;

// Windows-1252 extras in the 0x80–0x9F range, by Unicode code point.
const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
const isWinAnsi = (cp: number): boolean => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp);

const REPLACE: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...',
  ' ': ' ', ' ': ' ', ' ': ' ', 'ß': 'ss',
};

function filterChars(input: string, allowed: (cp: number) => boolean, keepSharpS: boolean): string {
  let out = '';
  for (const ch of input.replace(/[\r\n\t]+/g, ' ')) {
    const cp = ch.codePointAt(0) as number;
    if (allowed(cp) && !(ch === 'ß' && !keepSharpS)) { out += ch; continue; }
    const rep = REPLACE[ch];
    if (rep !== undefined) { out += rep; continue; }
    // Strip diacritics (e.g. "č" → "c") and keep whatever survives.
    const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += [...stripped].filter((c) => allowed(c.codePointAt(0) as number)).join('');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Make text safe for a QR-bill field and cut it to the field's maximum length. */
export const qrText = (s: string, max: number): string => filterChars(s ?? '', isQrAllowed, true).slice(0, max);

/** Make text drawable with the PDF standard fonts (WinAnsi). */
export const pdfText = (s: string): string => filterChars(s ?? '', isWinAnsi, true);
