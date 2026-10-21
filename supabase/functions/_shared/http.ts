const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS')
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean) ?? ['http://localhost:5173']

export function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && configuredOrigins.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

export function handleOptions(request: Request) {
  if (request.method !== 'OPTIONS') return null
  return new Response('ok', { headers: corsHeaders(request.headers.get('origin')) })
}

export function isAllowedOrigin(origin: string | null) {
  return Boolean(origin && configuredOrigins.includes(origin))
}
