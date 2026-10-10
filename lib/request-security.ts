const MAX_RATE_LIMIT_KEYS = 2_000;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimits = new Map<string, RateLimitEntry>();

export function requestClientKey(request: Request) {
  const trustedProxy = process.env.FLEETFLOW_TRUST_PROXY === "true";
  const forwarded = trustedProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  const agent = request.headers.get("user-agent")?.slice(0, 120) || "unknown-agent";
  return forwarded || agent;
}

export function consumeRateLimit(namespace: string, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [storedKey, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(storedKey);
    }
    if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) rateLimits.delete(rateLimits.keys().next().value as string);
  }
  const compoundKey = `${namespace}:${key}`;
  const current = rateLimits.get(compoundKey);
  if (!current || current.resetAt <= now) {
    rateLimits.set(compoundKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return { allowed: current.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)) };
}

export function checkRateLimit(namespace: string, key: string, limit: number) {
  const entry = rateLimits.get(`${namespace}:${key}`);
  if (!entry || entry.resetAt <= Date.now()) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: entry.count < limit, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1_000)) };
}

export function clearRateLimit(namespace: string, key: string) {
  rateLimits.delete(`${namespace}:${key}`);
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return originUrl.protocol === requestUrl.protocol && originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

export async function readJsonBody(request: Request, maximumBytes = 1_048_576): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error("REQUEST_TOO_LARGE");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("INVALID_JSON");
  }
}
