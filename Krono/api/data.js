import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from '@vercel/blob';
import { configured, sameOrigin, validSession } from '../lib/session.js';

const PATH = 'krono/private/data.json';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function isBlobNotFound(error) {
  return error instanceof BlobNotFoundError ||
    error?.name === 'BlobNotFoundError' ||
    error?.constructor?.name === 'BlobNotFoundError';
}

function isBlobPreconditionFailed(error) {
  return error instanceof BlobPreconditionFailedError ||
    error?.name === 'BlobPreconditionFailedError' ||
    error?.constructor?.name === 'BlobPreconditionFailedError';
}

async function getLatestBlob() {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await get(PATH, { access: 'private', useCache: false });
    } catch (error) {
      if (isBlobNotFound(error)) return null;
      if (attempt === 3) throw error;
      // Blob can briefly return a 5xx while another device is replacing the
      // same object. Retry the read before turning a normal sync race into a
      // failed save (and keep the retries bounded to avoid a request loop).
      await delay(120 * (2 ** attempt) + Math.random() * 100);
    }
  }
  return null;
}

function mergeConcurrentWrites(incoming, current) {
  const mergeList = (key, deletedKey, sort) => {
    const removed = [...new Set([...(current?.[deletedKey] || []), ...(incoming?.[deletedKey] || [])])];
    const byId = new Map();
    for (const item of current?.[key] || []) if (item?.id) byId.set(item.id, item);
    // The latest request wins when both devices edited the same record.
    for (const item of incoming?.[key] || []) if (item?.id) byId.set(item.id, item);
    const items = [...byId.values()].filter(item => !removed.includes(item.id));
    return { items: sort ? items.sort(sort) : items, removed };
  };
  const shifts = mergeList('shifts', 'deletedShiftIds', (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const events = mergeList('calendarEvents', 'deletedCalendarEventIds', (a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  const calendars = mergeList('calendars', 'deletedCalendarIds');
  return {
    ...current,
    ...incoming,
    shifts: shifts.items,
    deletedShiftIds: shifts.removed,
    calendarEvents: events.items,
    deletedCalendarEventIds: events.removed,
    calendars: calendars.items,
    deletedCalendarIds: calendars.removed,
    updatedAt: Math.max(Date.now(), Number(incoming?.updatedAt) || 0, Number(current?.updatedAt) || 0),
  };
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
      const blob = await getLatestBlob();
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
    const explicitLocalResolution = request.headers['x-krono-resolution'] === 'keep-local';
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
    let savedData = data;
    // The user has explicitly selected "keep this device" in the conflict
    // dialog. That is the only path allowed to replace the current blob
    // without an ETag; every autosave still uses ifMatch below.
    if (explicitLocalResolution) {
      stored = await put(PATH, JSON.stringify(savedData), {
        access: 'private',
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    } else {
      let etag = expected;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          stored = await put(PATH, JSON.stringify(savedData), {
            access: 'private',
            allowOverwrite: Boolean(etag),
            contentType: 'application/json',
            cacheControlMaxAge: 60,
            ...(etag ? { ifMatch: etag } : {}),
          });
          break;
        } catch (error) {
          if (!isBlobPreconditionFailed(error)) throw error;
          const latest = await getLatestBlob();
          if (!latest) {
            etag = null;
            continue;
          }
          const current = await new Response(latest.stream).json();
          savedData = mergeConcurrentWrites(savedData, current);
          etag = latest.blob.etag;
          await delay(160 * (2 ** Math.min(attempt, 3)) + Math.random() * 140);
        }
      }
      if (!stored) {
        const latest = await head(PATH, { access: 'private' }).catch(error => isBlobNotFound(error) ? null : Promise.reject(error));
        if (latest) response.setHeader('ETag', latest.etag);
        return response.status(409).json({ error: 'Los cambios se fusionaron, pero Vercel sigue recibiendo escrituras simultáneas. Se conserva la copia local; vuelve a intentarlo.' });
      }
    }
    response.setHeader('ETag', stored.etag);
    return response.status(200).json({ saved: true, data: savedData });
  } catch (error) {
    // Blob's conditional-write failure is an expected concurrency conflict,
    // not a storage outage. Keep it a 409 so clients fetch the newest version
    // and let the user decide how to resolve it instead of retrying a bad ETag.
    if (isBlobPreconditionFailed(error)) {
      return response.status(409).json({ error: 'Los datos cambiaron en otro dispositivo. Sincroniza antes de guardar.' });
    }
    console.error('Krono storage error:', error);
    return response.status(500).json({ error: 'No se pudo conectar con el almacenamiento privado de Vercel.' });
  }
}
