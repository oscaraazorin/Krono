import { randomUUID } from 'node:crypto';
import { configured } from '../../lib/session.js';
import { issue, readBody, safeRedirect } from '../../lib/oauth.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método no permitido.' });
  if (!configured()) return response.status(503).json({ error: 'Krono aún no está configurado en Vercel.' });
  const body = readBody(request);
  if (!Array.isArray(body.redirect_uris)) return response.status(400).json({ error: 'invalid_client_metadata' });
  const redirects = [...new Set(body.redirect_uris)];
  if (!redirects.length || redirects.length > 5 || redirects.some(uri => typeof uri !== 'string' || uri.length > 512 || !safeRedirect(uri))) {
    return response.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Se requieren URI de retorno HTTPS o localhost válidas.' });
  }
  const grants = body.grant_types || ['authorization_code'];
  if (!Array.isArray(grants)) return response.status(400).json({ error: 'invalid_client_metadata' });
  if (!grants.includes('authorization_code') || grants.some(grant => !['authorization_code', 'refresh_token'].includes(grant))) return response.status(400).json({ error: 'invalid_client_metadata' });
  const clientId = issue({ type: 'client', exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400, id: randomUUID(), name: String(body.client_name || 'MCP client').slice(0, 120), redirect_uris: redirects });
  return response.status(201).json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: String(body.client_name || 'MCP client').slice(0, 120), redirect_uris: redirects, grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' });
}
