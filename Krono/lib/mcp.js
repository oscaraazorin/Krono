import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from '@vercel/blob';

const PATH = 'krono/private/data.json';
const DEFAULT_BREAKS = { shortAt: 5.5, shortMinutes: 30, longAt: 8, longMinutes: 60, paid: false };

function missing(error) {
  return error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError' || error?.constructor?.name === 'BlobNotFoundError';
}

function seed() {
  const gross = Number(process.env.KRONO_MONTHLY_GROSS);
  const net = Number(process.env.KRONO_MONTHLY_NET);
  return {
    version: 2,
    jobs: [{ id: 'krono-current', name: 'Mi trabajo actual', rate: Number(process.env.KRONO_HOURLY_RATE), color: '#a8f25b', isCurrent: true }],
    shifts: [], currency: 'CHF', taxRate: 1 - net / gross, monthlyGross: gross, monthlyNet: net, breakRules: DEFAULT_BREAKS,
  };
}

export async function readKrono() {
  try {
    const blob = await get(PATH, { access: 'private', useCache: false });
    if (!blob) return { data: seed(), etag: null };
    return { data: await new Response(blob.stream).json(), etag: blob.blob.etag };
  } catch (error) {
    if (missing(error)) return { data: seed(), etag: null };
    throw error;
  }
}

export async function writeKrono(data, etag) {
  const current = await readKrono();
  if (current.etag !== etag) throw new Error('CONFLICT');
  data.updatedAt = Date.now();
  try {
    await put(PATH, JSON.stringify(data), {
      access: 'private', allowOverwrite: Boolean(etag), contentType: 'application/json', cacheControlMaxAge: 60,
      ...(etag ? { ifMatch: etag } : {}),
    });
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError') throw new Error('CONFLICT');
    throw error;
  }
}

export function shiftSpan(shift) {
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  let minutes = eh * 60 + em - sh * 60 - sm;
  if (minutes <= 0) minutes += 1440;
  return minutes;
}

export function paidHours(shift, rules = DEFAULT_BREAKS) {
  const span = shiftSpan(shift);
  let pause = 0;
  if (shift.pauseMinutes !== undefined && shift.pauseMinutes !== null && shift.pauseMinutes !== '') pause = Math.max(0, Number(shift.pauseMinutes) || 0);
  else if (span / 60 >= Number(rules.longAt)) pause = Number(rules.longMinutes) || 0;
  else if (span / 60 >= Number(rules.shortAt)) pause = Number(rules.shortMinutes) || 0;
  if (rules.paid) pause = 0;
  return Math.max(0, (span - pause) / 60);
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function weekStart(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function formatShift(shift, data) {
  const job = data.jobs.find(item => item.id === shift.jobId);
  const hours = paidHours(shift, data.breakRules || DEFAULT_BREAKS);
  const gross = hours * Number(job?.rate || 0);
  const tax = gross * Number(data.taxRate || 0);
  return { ...shift, jobName: job?.name || 'Sin trabajo asociado', paidHours: Math.round(hours * 100) / 100, gross: round(gross), estimatedTax: round(tax), estimatedNet: round(gross - tax), currency: data.currency || 'CHF' };
}

export function round(value) { return Math.round(value * 100) / 100; }
