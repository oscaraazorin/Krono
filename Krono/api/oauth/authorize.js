import { createHash, timingSafeEqual } from 'node:crypto';
import { configured } from '../../lib/session.js';
import { escapeHtml, issue, readBody, safeRedirect, verify } from '../../lib/oauth.js';

const KNOWN = ['krono:read', 'krono:write'];
function page(response, status, title, content) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return response.status(status).send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Krono</title><body style="margin:0;background:#0c0f15;color:#f3f5fa;font:16px system-ui;min-height:100vh;display:grid;place-items:center"><main style="box-sizing:border-box;width:min(440px,calc(100% - 32px));padding:28px;background:#141923;border:1px solid #293344;border-radius:20px"><div style="color:#a8f25b;font-weight:800;margin-bottom:16px">Krono</div><h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>${content}</main></body></html>`);
}

function loginForm(response, authreq, write, clientName, error = '') {
  const description = write
    ? 'Este asistente solicita consultar tus turnos e ingresos y también añadir o modificar turnos.'
    : 'Este asistente solicita consultar tus turnos e ingresos. No podrá modificarlos.';
  const content = `<p style="color:#a8f25b;font-weight:700">${escapeHtml(clientName)}</p>${error ? `<p role="alert" style="color:#ff8790;line-height:1.5">${escapeHtml(error)}</p>` : ''}<p style="color:#a5aec0;line-height:1.6">${escapeHtml(description)}</p><form method="post" action="/api/oauth/authorize" accept-charset="UTF-8"><input type="hidden" name="authreq" value="${escapeHtml(authreq)}"><label style="display:block;font-size:13px;margin:18px 0 6px">Contraseña de Krono</label><input required type="password" name="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:13px;background:#0e131b;color:#fff;border:1px solid #344053;border-radius:10px"><label style="display:flex;gap:9px;align-items:flex-start;margin:16px 0;color:#a5aec0;font-size:13px;line-height:1.5"><input type="checkbox" name="allowWrite" value="yes" ${write ? 'checked' : ''} style="margin-top:3px">Permitir que añada o modifique turnos</label><button type="submit" style="width:100%;margin-top:8px;padding:13px;border:0;border-radius:10px;background:#a8f25b;color:#10150d;font-weight:800">Autorizar asistente</button></form><p style="color:#768196;font-size:12px;margin:16px 0 0">Las claves de Vercel no se comparten. Puedes revocar el acceso cambiando la contraseña de Krono y el secreto de sesión en Vercel.</p>`;
  return page(response, 200, 'Conectar un asistente', content);
}

function loginMatches(password) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(process.env.KRONO_PASSWORD || ''), hash(password));
}

export default async function handler(request, response) {
  if (!configured()) return page(response, 503, 'Krono no está configurado', '<p>Configura primero el almacenamiento privado de Krono en Vercel.</p>');
  if (request.method === 'GET') {
    const q = request.query || {};
    const client = verify(q.client_id, 'client');
    const scopes = String(q.scope || 'krono:read').split(/\s+/).filter(scope => KNOWN.includes(scope));
    const redirect = client?.redirect_uris?.includes(q.redirect_uri);
    if (q.response_type !== 'code' || !client || !redirect || typeof q.state !== 'string' || q.state.length > 1024 || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge || '') || !scopes.includes('krono:read')) return page(response, 400, 'Solicitud no válida', '<p>El cliente no presentó una solicitud OAuth válida. Vuelve a iniciar la conexión desde el asistente.</p>');
    const authreq = issue({ type: 'authreq', exp: Math.floor(Date.now() / 1000) + 600, client_id: q.client_id, redirect_uri: q.redirect_uri, state: q.state, challenge: q.code_challenge, scope: scopes });
    return loginForm(response, authreq, scopes.includes('krono:write'), client.name);
  }
  if (request.method !== 'POST') return response.status(405).end();
  console.info('[krono-oauth] authorization form submitted');
  const body = readBody(request);
  const authorization = verify(body.authreq, 'authreq');
  const client = authorization && verify(authorization.client_id, 'client');
  if (!authorization || !client || !client.redirect_uris.includes(authorization.redirect_uri) || !safeRedirect(authorization.redirect_uri)) {
    console.warn('[krono-oauth] authorization request invalid or expired');
    return page(response, 400, 'Solicitud caducada', '<p>Vuelve a iniciar la conexión desde el asistente.</p>');
  }
  if (!loginMatches(body.password)) {
    console.warn('[krono-oauth] password rejected');
    return loginForm(response, body.authreq, authorization.scope.includes('krono:write'), client.name, 'La contraseña de Krono no coincide.');
  }
  const scope = ['krono:read', ...(authorization.scope.includes('krono:write') && body.allowWrite === 'yes' ? ['krono:write'] : [])];
  console.info('[krono-oauth] authorization approved', { write: scope.includes('krono:write') });
  const code = issue({ type: 'code', exp: Math.floor(Date.now() / 1000) + 180, client_id: authorization.client_id, redirect_uri: authorization.redirect_uri, challenge: authorization.challenge, scope });
  const target = new URL(authorization.redirect_uri);
  target.searchParams.set('code', code);
  target.searchParams.set('state', authorization.state);
  const content = `<p style="color:#a5aec0;line-height:1.6">El permiso se ha concedido. Pulsa este botón para volver a Codex y terminar la conexión.</p><a href="${escapeHtml(target.toString())}" style="display:block;text-align:center;text-decoration:none;margin-top:20px;padding:13px;border-radius:10px;background:#a8f25b;color:#10150d;font-weight:800">Volver a Codex</a><p style="color:#768196;font-size:12px;line-height:1.5;margin:16px 0 0">Si el navegador avisa de que no encuentra la página, deja esta pestaña abierta: Codex recibirá el enlace igualmente.</p>`;
  return page(response, 200, 'Permiso concedido', content);
}
