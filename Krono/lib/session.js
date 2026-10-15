import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'krono_session';
const TTL_SECONDS = 60 * 60 * 24 * 14;

export function configured() {
  return Boolean(
    process.env.KRONO_PASSWORD &&
    process.env.KRONO_SESSION_SECRET && process.env.KRONO_SESSION_SECRET.length >= 32 &&
    (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) &&
    Number(process.env.KRONO_HOURLY_RATE) > 0 &&
    Number(process.env.KRONO_MONTHLY_GROSS) > 0 &&
    Number(process.env.KRONO_MONTHLY_NET) > 0,
  );
}

export function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function signature(expiry) {
  return createHmac('sha256', process.env.KRONO_SESSION_SECRET).update(expiry).digest('base64url');
}

export function validSession(request) {
  if (!configured()) return false;
  const cookie = request.headers.cookie || '';
  const value = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value) return false;
  const [expiry, signed] = value.split('.');
  if (!expiry || !signed || Number(expiry) < Math.floor(Date.now() / 1000)) return false;
  const expected = signature(expiry);
  if (signed.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signed), Buffer.from(expected));
}

export function sessionCookie(request, clear = false) {
  const expiry = clear ? '0' : String(Math.floor(Date.now() / 1000) + TTL_SECONDS);
  const value = clear ? '' : `${expiry}.${signature(expiry)}`;
  const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : TTL_SECONDS}${secure}`;
}
