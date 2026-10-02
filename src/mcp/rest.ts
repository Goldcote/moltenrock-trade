// REST mirror of the agent tools (for agents/tools without MCP), plus the OpenAPI document and
// /llms.txt — all generated from the same tool registry.

import type { Env } from '../lib/env';
import { AppError, jsonResponse, withHeaders } from '../lib/http';
import { authenticateAgent } from '../domain/tokens';
import { getShop } from '../domain/settings';
import { callTool, toolsFor } from './executor';
import { INSTRUCTIONS } from './server';
import { TOOLS } from './tools';

export async function handleRestTool(req: Request, env: Env, baseUrl: string, name: string): Promise<Response> {
  try {
    const actor = await authenticateAgent(env, req);
    let args: unknown = {};
    if (req.headers.get('Content-Type')?.includes('application/json')) {
      try { args = await req.json(); } catch { throw new AppError('INVALID_JSON', 'Body must be JSON'); }
    }
    const idem = req.headers.get('Idempotency-Key');
    if (idem && args && typeof args === 'object') (args as Record<string, unknown>).idempotency_key ??= idem;
    return jsonResponse({ ok: true, result: await callTool(env, actor, baseUrl, name, args) });
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError('INTERNAL', 'Unexpected error', 500);
    if (!(e instanceof AppError)) console.error(e);
    return jsonResponse({ ok: false, error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status);
  }
}

export async function handleRestList(req: Request, env: Env): Promise<Response> {
  try {
    const actor = await authenticateAgent(env, req);
    return jsonResponse({ ok: true, scope: actor.scope, tools: toolsFor(actor).map((t) => ({ name: t.name, title: t.title, description: t.description, scope: t.scope, mutates: t.mutates, input_schema: t.inputSchema })) });
  } catch (e) {
    const err = e as AppError;
    return jsonResponse({ ok: false, error: { code: err.code, message: err.message } }, err.status ?? 401);
  }
}

export function openApi(baseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const t of TOOLS) {
    paths[`/api/v1/tools/${t.name}`] = {
      post: {
        operationId: t.name, summary: t.title, description: `${t.description}\n\nRequired scope: ${t.scope}.`,
        tags: [t.scope], security: [{ agentToken: [] }],
        ...(t.mutates ? { parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 100 } }] } : {}),
        requestBody: { required: false, content: { 'application/json': { schema: t.inputSchema } } },
        responses: {
          200: { description: 'Success: { ok: true, result }' },
          400: { description: 'INVALID_ARGUMENTS and other request errors: { ok: false, error: { code, message } }' },
          401: { description: 'Missing, unknown or revoked agent token' },
          403: { description: 'INSUFFICIENT_SCOPE or HUMAN_ONLY' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'MoltenRock Trade agent API', version: '0.1.0', description: INSTRUCTIONS },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { agentToken: { type: 'http', scheme: 'bearer', description: 'Agent token (mt_…) created by the shop owner.' } } },
    paths,
  };
}

export async function llmsTxt(env: Env, baseUrl: string): Promise<Response> {
  const shop = await getShop(env.DB);
  const lines = [
    `# ${shop?.legal_name ?? 'MoltenRock Trade'} — trade portal (MoltenRock Trade)`,
    '',
    '> A Swiss B2B trade portal designed to be run by an AI agent. Trade customers order at net tier prices and pay by QR-bill invoice. The merchant\'s agent configures and operates everything; the merchant confirms trust and money decisions.',
    '',
    '## Connect',
    `- MCP (Streamable HTTP): ${baseUrl}/mcp — header "Authorization: Bearer <agent token>" (or "X-API-Key: <agent token>")`,
    `- REST: POST ${baseUrl}/api/v1/tools/<tool> with a JSON body — same token; OpenAPI at ${baseUrl}/api/v1/openapi.json`,
    '- Tokens are created by the shop owner on the merchant page, with access: read, operate or configure.',
    '',
    '## Rules',
    ...INSTRUCTIONS.split('\n').map((l) => `- ${l}`),
    '',
    '## Tools',
    ...TOOLS.map((t) => `- ${t.name} (${t.scope}): ${t.description}`),
    '',
  ];
  return withHeaders(new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } }));
}
