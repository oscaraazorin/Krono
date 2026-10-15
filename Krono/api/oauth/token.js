import { createHash } from 'node:crypto';
import { configured } from '../../lib/session.js';
import { issue, readBody, verify } from '../../lib/oauth.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método no permitido.' });
  if (!configured()) return response.status(503).json({ error: 'Krono aún no está configurado en Vercel.' });
  const body = readBody(request);
  if (body.grant_type !== 'authorization_code') return response.status(400).json({ error: 'unsupported_grant_type' });
  const authorization = verify(body.code, 'code');
  const clientId = String(body.client_id || '');
  if (!authorization || authorization.client_id !== clientId || authorization.redirect_uri !== body.redirect_uri) return response.status(400).json({ error: 'invalid_grant' });
  if (typeof body.code_verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(body.code_verifier)) return response.status(400).json({ error: 'invalid_grant' });
  const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
  if (challenge !== authorization.challenge) return response.status(400).json({ error: 'invalid_grant' });
  const base = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers.host}`;
  const expiresIn = 14 * 24 * 60 * 60;
  const accessToken = issue({ type: 'access', exp: Math.floor(Date.now() / 1000) + expiresIn, aud: `${base}/mcp`, scope: authorization.scope, client_id: clientId });
  return response.status(200).json({ access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope: authorization.scope.join(' ') });
}
