import qrcode from 'qrcode-generator';

// Swiss QR codes are UTF-8 encoded ("Coding type 1"); make the generator emit UTF-8 bytes.
qrcode.stringToBytes = (s: string): number[] => [...new TextEncoder().encode(s)];

/** Module matrix for a Swiss QR code: error-correction level M (as required by the IG). */
export function qrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  if (n > 117) throw new Error('QR payload too large (max version 25)');
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
