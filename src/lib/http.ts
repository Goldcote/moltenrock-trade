import type { Html } from './html';

// Security headers applied to every dynamic response. Note: a `_headers` file only covers static
// assets, so these MUST be set here in code.
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; " +
    "font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
};

// Anything with prices or personal data must never be cached by a browser, proxy or CDN.
export const PRIVATE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie, Authorization',
};

export function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

export function htmlResponse(body: Html, init: { status?: number; private?: boolean; headers?: Record<string, string> } = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    ...(init.private !== false ? PRIVATE_HEADERS : { 'Cache-Control': 'no-cache' }),
    ...init.headers,
  };
  return withHeaders(new Response('<!doctype html>' + body.value, { status: init.status ?? 200, headers }));
}

export function jsonResponse(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return withHeaders(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE_HEADERS, ...extra },
    }),
  );
}

/** Stable, machine-readable error shape used by the REST API and MCP tool errors. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const redirect = (location: string, extra: Record<string, string> = {}): Response =>
  withHeaders(new Response(null, { status: 303, headers: { Location: location, ...PRIVATE_HEADERS, ...extra } }));

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export const safeNext = (next: string | null | undefined, fallback: string): string =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;

export async function readForm(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('Content-Type') ?? '';
  if (!ct.includes('application/x-www-form-urlencoded') && !ct.includes('multipart/form-data')) return {};
  const fd = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v.trim();
  return out;
}
