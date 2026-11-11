// Server-side Pages Function. Never expose ADMIN_TOKEN to client-side code.
const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const decode = s => JSON.parse(new TextDecoder().decode(b64url(s)));
async function verifyAccess(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/\/$/, '');
  const aud = env.ACCESS_AUD;
  if (!jwt || !team || !/^https:\/\/[a-zA-Z0-9-]+\.cloudflareaccess\.com$/.test(team) || !aud) return false;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return false;
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== team || !Array.isArray(payload.aud) || !payload.aud.includes(aud) ||
        !Number.isFinite(payload.exp) || payload.exp <= now ||
        !Number.isFinite(payload.iat) || payload.iat > now + 60 ||
        (payload.nbf != null && payload.nbf > now)) return false;
    const keysResponse = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!keysResponse.ok) return false;
    const keys = await keysResponse.json();
    const jwk = keys.keys?.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { return false; }
}
export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== 'GET') return respond({ error: 'Method not allowed' }, 405);
  if (!(await verifyAccess(request, env))) return respond({ error: 'Access authentication required' }, 401);
  if (!env.ADMIN_TOKEN || !env.VOZ_API_BASE) return respond({ error: 'Server configuration incomplete' }, 503);
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  let upstreamPath;
  if (segments.length === 1 && segments[0] === 'refunds') upstreamPath = '/api/admin/refunds';
  else if (segments.length === 2 && segments[0] === 'refunds' && /^[a-f0-9-]{36}$/i.test(segments[1]))
    upstreamPath = `/api/admin/refunds/${segments[1]}`;
  else return respond({ error: 'Not found' }, 404);
  const input = new URL(request.url);
  const upstream = new URL(upstreamPath, env.VOZ_API_BASE);
  if (segments.length === 1) {
    for (const key of ['status', 'limit', 'offset']) {
      const value = input.searchParams.get(key);
      if (value != null) upstream.searchParams.set(key, value);
    }
  }
  try {
    const result = await fetch(upstream, { headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}`, Accept: 'application/json' }, redirect: 'error' });
    console.log('Voz refund upstream status:', result.status);
    console.log('Voz refund upstream content type:',
      result.headers.get('content-type') || 'missing');
    const text = await result.text();
    if (text.length > 500000) return respond({ error: 'Unexpected upstream response size' }, 502);
    const data = JSON.parse(text);
    return respond(data, result.status);
  } catch (error) {
    const message = String(error?.message || '');

    let failureType = 'unknown';

    if (error instanceof SyntaxError) {
      failureType = 'invalid_upstream_json';
    } else if (error instanceof TypeError) {
      failureType = 'upstream_fetch_or_response_error';
    }

    return respond({
      error: 'Refund service unavailable',
      diagnostic: failureType
    }, 502);
  }
}
