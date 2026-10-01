// MCP server over Streamable HTTP (stateless): POST /mcp with one JSON-RPC 2.0 message per request.
// Auth is a bearer agent token created by the owner. Tool errors are returned as tool results with
// isError: true (so the agent can read and recover); protocol errors use JSON-RPC error objects.

import type { Env } from '../lib/env';
import { AppError, jsonResponse, withHeaders, PRIVATE_HEADERS } from '../lib/http';
import { authenticateAgent } from '../domain/tokens';
import { callTool, toolsFor } from './executor';
import { VERSION } from '../version';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'moltenrock-trade', title: 'MoltenRock Trade — Swiss B2B trade portal', version: VERSION };

const INSTRUCTIONS = `You operate a Swiss B2B trade portal on behalf of the merchant (your human).
Start with get_setup_status and follow next_action until the shop is ready.
Any shop works: WooCommerce connects with a read-only key (connect_shop + import_catalog); for any other shop, a website, a spreadsheet or a feed, read the products yourself and add them with upsert_products. Never invent a price: prices you add become orderable only after your human confirms them under Approvals.
Money is in rappen (CHF 1.00 = 100); discounts are basis points (4000 = 40 %). Prices shown to trade customers are NET (excl. VAT).
You can configure almost everything. You can NEVER change company identity, VAT number or bank details, and you cannot approve partners, held orders or credit notes yourself — propose them (propose_*) and tell your human to confirm on the Approvals page.
When your human wants to see settings or numbers, use get_status_page_link and share the link.
Write product texts in natural Swiss German (use "ss", never "ß"), French, Italian and English.`;

type RpcId = string | number | null;
const rpcResult = (id: RpcId, result: unknown) => jsonResponse({ jsonrpc: '2.0', id, result });
const rpcError = (id: RpcId, code: number, message: string, data?: unknown, status = 200) =>
  jsonResponse({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }, status);

export async function handleMcp(req: Request, env: Env, baseUrl: string): Promise<Response> {
  if (req.method !== 'POST') return withHeaders(new Response(null, { status: 405, headers: { Allow: 'POST', ...PRIVATE_HEADERS } }));
  // DNS-rebinding protection: browsers send Origin; only our own origin may call from a browser.
  const originHeader = req.headers.get('Origin');
  if (originHeader && originHeader !== new URL(req.url).origin) return rpcError(null, -32000, 'Origin not allowed', undefined, 403);

  let actor;
  try { actor = await authenticateAgent(env, req); }
  catch (e) {
    const err = e as AppError;
    // Tells MCP clients where to start one-address connect (OAuth), per the MCP authorization spec.
    return withHeaders(jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32001, message: err.message } }, 401),
      { 'WWW-Authenticate': `Bearer realm="moltenrock-trade", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"` });
  }

  let msg: { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> };
  try { msg = await req.json(); } catch { return rpcError(null, -32700, 'Parse error'); }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'Batching is not supported; send one message per request.');
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id ?? null, -32600, 'Invalid Request');
  const id = msg.id ?? null;
  if (msg.id === undefined) return withHeaders(new Response(null, { status: 202, headers: PRIVATE_HEADERS })); // notification

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return rpcResult(id, {
        protocolVersion: SUPPORTED.includes(requested) ? requested : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: toolsFor(actor).map((t) => ({
          name: t.name, title: t.title, description: `${t.description} [needs: ${t.scope}]`, inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !t.mutates, destructiveHint: false, idempotentHint: !t.mutates, openWorldHint: t.name === 'connect_shop' || t.name === 'import_catalog' },
        })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      try {
        const result = await callTool(env, actor, baseUrl, name, msg.params?.arguments);
        const structured = result && typeof result === 'object' && !Array.isArray(result) ? result : { items: result };
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: structured, isError: false });
      } catch (e) {
        if (e instanceof AppError && e.code === 'UNKNOWN_TOOL') return rpcError(id, -32602, e.message);
        const err = e instanceof AppError ? { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } : { code: 'INTERNAL', message: 'Unexpected error' };
        if (!(e instanceof AppError)) console.error('tool error', name, e);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: err }) }], structuredContent: { error: err }, isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export { INSTRUCTIONS };
