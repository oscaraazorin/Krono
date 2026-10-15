import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = () => process.env.KRONO_SESSION_SECRET || '';

export function issue(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', SECRET()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verify(token, type) {
  if (typeof token !== 'string' || token.length > 12000) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', SECRET()).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000) || (type && payload.type !== type)) return null;
    return payload;
  } catch { return null; }
}

export function bearer(request, scope) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = verify(header.slice(7), 'access');
  const origin = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers.host}`;
  if (!token || token.aud !== `${origin}/mcp` || !Array.isArray(token.scope) || !token.scope.includes(scope)) return null;
  return token;
}

export function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  const raw = typeof request.body === 'string' ? request.body : '';
  const contentType = request.headers['content-type'] || '';
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function safeRedirect(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || ['cursor:', 'vscode:', 'claude:', 'codex:', 'chatgpt:'].includes(url.protocol);
  } catch { return false; }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
