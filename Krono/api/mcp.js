import { randomUUID } from 'node:crypto';
import { configured } from '../lib/session.js';
import { bearer } from '../lib/oauth.js';
import { formatShift, readKrono, round, validDate, weekStart, writeKrono } from '../lib/mcp.js';

const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'MCP-Session-Id, WWW-Authenticate',
};
const protocolVersions = ['2025-11-25', '2025-03-26', '2024-11-05'];

const tools = [
  { name: 'krono_get_summary', title: 'Consultar resumen', description: 'Consulta las horas registradas y la estimación bruta, neta y de deducciones para una semana o un mes. Usa una fecha ISO local como 2026-10-15.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['week', 'month'], description: 'Periodo del resumen.' }, date: { type: 'string', description: 'Fecha ISO YYYY-MM-DD dentro del periodo; por defecto hoy.' } }, required: ['period'], additionalProperties: false } },
  { name: 'krono_list_shifts', title: 'Consultar turnos', description: 'Lista los turnos registrados entre dos fechas, con horario, horas pagadas y estimación salarial.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { startDate: { type: 'string', description: 'Fecha inicial inclusiva YYYY-MM-DD.' }, endDate: { type: 'string', description: 'Fecha final inclusiva YYYY-MM-DD.' } }, required: ['startDate', 'endDate'], additionalProperties: false } },
  { name: 'krono_list_jobs', title: 'Consultar trabajos', description: 'Lista los perfiles de empleo y sus tarifas por hora configuradas en Krono.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'krono_add_shift', title: 'Añadir turno', description: 'Añade un turno al calendario. Pide o confirma la fecha y las horas si no están claras. Pausas y sueldo se calculan según los ajustes actuales de Krono.', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'Fecha local YYYY-MM-DD.' }, start: { type: 'string', description: 'Hora de inicio HH:MM, formato 24 h.' }, end: { type: 'string', description: 'Hora final HH:MM, formato 24 h.' }, jobId: { type: 'string', description: 'ID de un perfil devuelto por krono_list_jobs. Si se omite, se usa el trabajo actual.' }, type: { type: 'string', enum: ['contract', 'extra'], description: 'Tipo de horas.' }, notes: { type: 'string', description: 'Nota opcional.' } }, required: ['date', 'start', 'end'], additionalProperties: false } },
  { name: 'krono_update_shift', title: 'Modificar turno', description: 'Modifica un turno existente usando su ID de krono_list_shifts. Solo cambia los campos que se indiquen.', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ID del turno.' }, date: { type: 'string', description: 'Nueva fecha local YYYY-MM-DD.' }, start: { type: 'string', description: 'Nueva hora de inicio HH:MM.' }, end: { type: 'string', description: 'Nueva hora final HH:MM.' }, jobId: { type: 'string', description: 'ID del perfil de empleo.' }, type: { type: 'string', enum: ['contract', 'extra'] }, notes: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'krono_delete_shift', title: 'Eliminar turno', description: 'Elimina un turno existente. Úsalo solo cuando el usuario lo pida expresamente y confirma el día y horario antes de borrar.', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ID del turno.' } }, required: ['id'], additionalProperties: false } },
];

function json(response, status, body) { return response.status(status).json(body); }
function fail(message) { throw new Error(message); }
function validateTime(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validateJob(data, jobId) { return !jobId || data.jobs.some(job => job.id === jobId); }
function summarize(data, shifts, startDate, endDate) {
  const selected = shifts.filter(shift => shift.date >= startDate && shift.date <= endDate);
  const rows = selected.map(shift => formatShift(shift, data));
  const hours = rows.reduce((sum, shift) => sum + shift.paidHours, 0);
  const gross = rows.reduce((sum, shift) => sum + shift.gross, 0);
  const estimatedTax = rows.reduce((sum, shift) => sum + shift.estimatedTax, 0);
  return { startDate, endDate, shifts: rows, shiftCount: rows.length, paidHours: round(hours), gross: round(gross), estimatedTax: round(estimatedTax), net: round(gross - estimatedTax), currency: data.currency || 'CHF' };
}
function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()); }

async function runTool(name, args) {
  const needsWrite = ['krono_add_shift', 'krono_update_shift', 'krono_delete_shift'].includes(name);
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('Los parámetros no son válidos.');
  const { data, etag } = await readKrono();
  if (name === 'krono_list_jobs') return { jobs: data.jobs.map(({ id, name, rate, color, isCurrent }) => ({ id, name, rate, currency: data.currency || 'CHF', color, isCurrent: !!isCurrent })) };
  if (name === 'krono_list_shifts') {
    if (!validDate(args.startDate) || !validDate(args.endDate) || args.endDate < args.startDate) fail('Indica un intervalo válido de fechas ISO.');
    const days = (Date.parse(`${args.endDate}T12:00:00Z`) - Date.parse(`${args.startDate}T12:00:00Z`)) / 86400000;
    if (days > 366) fail('Consulta como máximo un año de turnos cada vez.');
    return summarize(data, data.shifts, args.startDate, args.endDate);
  }
  if (name === 'krono_get_summary') {
    if (!['week', 'month'].includes(args.period)) fail('El periodo debe ser week o month.');
    const date = args.date || localToday();
    if (!validDate(date)) fail('La fecha debe tener formato YYYY-MM-DD.');
    let startDate, endDate;
    if (args.period === 'week') {
      startDate = weekStart(date);
      const end = new Date(`${startDate}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); endDate = end.toISOString().slice(0, 10);
    } else {
      startDate = `${date.slice(0, 7)}-01`;
      endDate = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);
    }
    return summarize(data, data.shifts, startDate, endDate);
  }
  if (!needsWrite) fail('Herramienta desconocida.');
  if (name === 'krono_add_shift') {
    if (!validDate(args.date) || !validateTime(args.start) || !validateTime(args.end) || args.start === args.end) fail('Indica fecha y horario válidos en formato local 24 h.');
    if (args.notes && (typeof args.notes !== 'string' || args.notes.length > 500)) fail('La nota no puede superar 500 caracteres.');
    const jobId = args.jobId ?? data.jobs.find(job => job.isCurrent)?.id ?? '';
    if (!validateJob(data, jobId)) fail('El trabajo indicado no existe. Consulta krono_list_jobs.');
    const shift = { id: randomUUID(), date: args.date, start: args.start, end: args.end, jobId, type: args.type === 'extra' ? 'extra' : 'contract', notes: args.notes || '' };
    data.shifts.push(shift);
    await writeKrono(data, etag);
    return { saved: true, shift: formatShift(shift, data) };
  }
  if (name === 'krono_update_shift') {
    if (typeof args.id !== 'string' || !args.id) fail('Falta el ID del turno.');
    const shift = data.shifts.find(item => item.id === args.id);
    if (!shift) fail('No existe ese turno; consulta krono_list_shifts para ver sus IDs.');
    const next = { ...shift };
    for (const key of ['date', 'start', 'end', 'jobId', 'type', 'notes']) if (args[key] !== undefined) next[key] = args[key];
    if (!validDate(next.date) || !validateTime(next.start) || !validateTime(next.end) || next.start === next.end) fail('Fecha u horario no válido.');
    if (!validateJob(data, next.jobId)) fail('El trabajo indicado no existe. Consulta krono_list_jobs.');
    if (!['contract', 'extra'].includes(next.type)) fail('Tipo de horas no válido.');
    if (typeof next.notes !== 'string' || next.notes.length > 500) fail('La nota no puede superar 500 caracteres.');
    data.shifts = data.shifts.map(item => item.id === args.id ? next : item);
    await writeKrono(data, etag);
    return { saved: true, shift: formatShift(next, data) };
  }
  if (name === 'krono_delete_shift') {
    if (typeof args.id !== 'string' || !args.id) fail('Falta el ID del turno.');
    const shift = data.shifts.find(item => item.id === args.id);
    if (!shift) fail('No existe ese turno; consulta krono_list_shifts para ver sus IDs.');
    const deleted = formatShift(shift, data);
    data.shifts = data.shifts.filter(item => item.id !== args.id);
    await writeKrono(data, etag);
    return { deleted: true, shift: deleted };
  }
  fail('Herramienta desconocida.');
}

export default async function handler(request, response) {
  Object.entries(headers).forEach(([key, value]) => response.setHeader(key, value));
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'MCP acepta solicitudes POST.' });
  if (!configured()) return json(response, 503, { error: 'Krono aún no está configurado en Vercel.' });
  const token = bearer(request, 'krono:read') || bearer(request, 'krono:write');
  if (!token) {
    response.setHeader('WWW-Authenticate', `Bearer resource_metadata="https://${request.headers.host}/.well-known/oauth-protected-resource/mcp"`);
    return json(response, 401, { error: 'Autoriza Krono para consultar o gestionar turnos.' });
  }
  try {
    const message = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return json(response, 400, { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Solicitud JSON-RPC no válida.' } });
    if (!Object.hasOwn(message, 'id')) return response.status(202).end();
    let result;
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      result = { protocolVersion: protocolVersions.includes(requested) ? requested : '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'krono', version: '1.0.0' }, instructions: 'Krono guarda un calendario personal de turnos. Consulta con krono_get_summary o krono_list_shifts; utiliza krono_add_shift, krono_update_shift o krono_delete_shift solo cuando el usuario pida explícitamente el cambio. Las pausas, horas pagadas e ingresos se calculan con los ajustes actuales. El acceso de escritura depende del consentimiento OAuth concedido por el usuario.' };
    } else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools };
    else if (message.method === 'tools/call') {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      const writeTool = ['krono_add_shift', 'krono_update_shift', 'krono_delete_shift'].includes(name);
      const requiredScope = writeTool ? 'krono:write' : 'krono:read';
      if (!tools.some(tool => tool.name === name)) result = { content: [{ type: 'text', text: 'Herramienta desconocida.' }], isError: true };
      else if (!bearer(request, requiredScope)) result = { content: [{ type: 'text', text: writeTool ? 'Esta conexión solo tiene permiso de lectura. Vuelve a autorizar Krono con permiso de escritura.' : 'Esta conexión no tiene permiso para leer datos de Krono.' }], isError: true };
      else {
        try { result = { content: [{ type: 'text', text: JSON.stringify(await runTool(name, args)) }] }; }
        catch (error) { result = { content: [{ type: 'text', text: error.message === 'CONFLICT' ? 'Krono cambió en otro dispositivo mientras se editaba. Vuelve a consultar los datos antes de intentarlo de nuevo.' : (error.message || 'No se pudo completar la operación.') }], isError: true }; }
      }
    } else return json(response, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Método no disponible: ${message.method}` } });
    return json(response, 200, { jsonrpc: '2.0', id: message.id, result });
  } catch {
    return json(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido.' } });
  }
}
