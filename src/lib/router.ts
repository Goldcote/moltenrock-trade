// A tiny method + path router with :params. Enough for this app; no dependency needed.

export type Params = Record<string, string>;
export type Handler<C> = (ctx: C, params: Params) => Promise<Response> | Response;

interface Route<C> {
  method: string;
  parts: string[];
  handler: Handler<C>;
}

export class Router<C> {
  private routes: Route<C>[] = [];

  on(method: string, path: string, handler: Handler<C>): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
    return this;
  }
  get(path: string, h: Handler<C>) { return this.on('GET', path, h); }
  post(path: string, h: Handler<C>) { return this.on('POST', path, h); }

  match(method: string, pathname: string): { handler: Handler<C>; params: Params } | { methodNotAllowed: true } | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = r.parts[i] as string;
        const pp = parts[i] as string;
        if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(pp);
        else if (rp !== pp) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
