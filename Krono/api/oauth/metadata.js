import { configured } from '../../lib/session.js';

function origin(request) { return `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers.host}`; }

export async function authorizationServer(request, response) {
  response.setHeader('Cache-Control', 'public, max-age=300');
  if (request.method !== 'GET') return response.status(405).end();
  const base = origin(request);
  return response.status(200).json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['krono:read', 'krono:write'],
    service_documentation: `${base}/README.md`,
  });
}

export async function protectedResource(request, response) {
  response.setHeader('Cache-Control', 'public, max-age=300');
  if (request.method !== 'GET') return response.status(405).end();
  const base = origin(request);
  return response.status(configured() ? 200 : 503).json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['krono:read', 'krono:write'], bearer_methods_supported: ['header'] });
}

export default async function handler(request, response) {
  return request.query?.kind === 'resource'
    ? protectedResource(request, response)
    : authorizationServer(request, response);
}
