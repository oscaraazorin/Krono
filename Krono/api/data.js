import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from '@vercel/blob';
import { configured, sameOrigin, validSession } from '../lib/session.js';

const PATH = 'krono/private/data.json';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function isBlobNotFound(error) {
  return error instanceof BlobNotFoundError ||
    error?.name === 'BlobNotFoundError' ||
    error?.constructor?.name === 'BlobNotFoundError';
}

function initialProfile() {
  const gross = Number(process.env.KRONO_MONTHLY_GROSS);
  const net = Number(process.env.KRONO_MONTHLY_NET);
  return {
    version: 2,
    jobs: [{ id: 'krono-current', name: 'Mi trabajo actual', rate: Number(process.env.KRONO_HOURLY_RATE), color: '#a8f25b', isCurrent: true }],
    shifts: [],
    currency: 'CHF',
    taxRate: 1 - net / gross,
    monthlyGross: gross,
    monthlyNet: net,
    breakRules: { shortAt: 5.5, shortMinutes: 30, longAt: 8, longMinutes: 60, paid: false },
  };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', HEADERS['Cache-Control']);
  response.setHeader('X-Content-Type-Options', HEADERS['X-Content-Type-Options']);
  if (!configured()) return response.status(503).json({ error: 'Sincronización aún no configurada en Vercel.' });
  if (!validSession(request)) return response.status(401).json({ error: 'Inicia sesión para sincronizar.' });

  try {
    if (request.method === 'GET') {
      const blob = await get(PATH, { access: 'private', useCache: false });
      if (!blob) {
        response.setHeader('X-Krono-Seed', 'true');
        return response.status(200).json(initialProfile());
      }
      const data = await new Response(blob.stream).json();
      response.setHeader('ETag', blob.blob.etag);
      return response.status(200).json(data);
    }
    if (request.method !== 'PUT') return response.status(405).json({ error: 'Método no permitido.' });
    if (!sameOrigin(request)) return response.status(403).json({ error: 'Origen no válido.' });

    const data = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!data || !Array.isArray(data.jobs) || !Array.isArray(data.shifts) || JSON.stringify(data).length > 1_000_000) {
      return response.status(400).json({ error: 'Los datos de Krono no son válidos.' });
    }
    const expected = request.headers['if-match'];
    let existing = null;
    // When the client supplies the ETag it received from GET, use that token
    // directly in Blob's conditional write. A separate HEAD can return stale
    // metadata and otherwise create a conflict that cannot be resolved by
    // reloading the current blob.
    if (!expected) {
      try { existing = await head(PATH, { access: 'private' }); }
      catch (error) { if (!isBlobNotFound(error)) throw error; }
      if (existing) {
        response.setHeader('ETag', existing.etag);
        return response.status(409).json({ error: 'Los datos ya existen en Vercel. Recárgalos antes de guardar.' });
      }
    }
    let stored;
    try {
      stored = await put(PATH, JSON.stringify(data), {
      access: 'private',
      allowOverwrite: Boolean(expected),
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      ...(expected ? { ifMatch: expected } : {}),
      });
    } catch (error) {
      if (!expected) {
        try {
          const winner = await head(PATH, { access: 'private' });
          response.setHeader('ETag', winner.etag);
          return response.status(409).json({ error: 'Otro dispositivo inicializó Krono al mismo tiempo. Sincroniza los datos antes de guardar.' });
        } catch (headError) {
          if (!isBlobNotFound(headError)) throw headError;
        }
      }
      throw error;
    }
    response.setHeader('ETag', stored.etag);
    return response.status(200).json({ saved: true });
  } catch (error) {
    // Blob's conditional-write failure is an expected concurrency conflict,
    // not a storage outage. Keep it a 409 so clients fetch the newest version
    // and let the user decide how to resolve it instead of retrying a bad ETag.
    if (error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError') {
      return response.status(409).json({ error: 'Los datos cambiaron en otro dispositivo. Sincroniza antes de guardar.' });
    }
    console.error('Krono storage error:', error);
    return response.status(500).json({ error: 'No se pudo conectar con el almacenamiento privado de Vercel.' });
  }
}
