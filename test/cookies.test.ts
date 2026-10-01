import { describe, expect, it } from 'vitest';
import { cookieAttrs, sessionCookieName } from '../src/domain/auth';

describe('session cookie', () => {
  it('is strict (__Host- + Secure) on every real https address', () => {
    const req = new Request('https://b2b.example.ch/merchant');
    expect(sessionCookieName(req)).toBe('__Host-mt_session');
    expect(cookieAttrs(req)).toContain('Secure');
  });

  it('is a plain cookie on local http, which Safari would otherwise drop', () => {
    for (const url of ['http://localhost:8787/merchant', 'http://127.0.0.1:8787/']) {
      const req = new Request(url);
      expect(sessionCookieName(req)).toBe('mt_session');
      expect(cookieAttrs(req)).not.toContain('Secure');
    }
  });

  it('never relaxes on plain http to any other host', () => {
    expect(sessionCookieName(new Request('http://b2b.example.ch/'))).toBe('__Host-mt_session');
  });
});
