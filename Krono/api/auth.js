import { createHash, timingSafeEqual } from 'node:crypto';
import { configured, sameOrigin, sessionCookie, validSession } from '../lib/session.js';

function hash(value) { return createHash('sha256').update(value).digest(); }

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET') {
    return response.status(200).json({ configured: configured(), authenticated: validSession(request) });
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método no permitido.' });
  if (!sameOrigin(request)) return response.status(403).json({ error: 'Origen no válido.' });
  if (!configured()) return response.status(503).json({ error: 'Completa la configuración privada de Krono en Vercel.' });

  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
  if (body.action === 'logout') {
    response.setHeader('Set-Cookie', sessionCookie(request, true));
    return response.status(200).json({ authenticated: false });
  }
  if (body.action !== 'login' || typeof body.password !== 'string' || body.password.length > 256) {
    return response.status(400).json({ error: 'Solicitud no válida.' });
  }
  const expected = hash(process.env.KRONO_PASSWORD);
  const supplied = hash(body.password);
  if (!timingSafeEqual(expected, supplied)) return response.status(401).json({ error: 'La contraseña no coincide.' });

  response.setHeader('Set-Cookie', sessionCookie(request));
  return response.status(200).json({ authenticated: true });
}
