/**
 * In-memory sliding-window rate limiter.
 *
 * Best-effort guard for serverless — resets on cold start, which is
 * acceptable for cost protection (prevents rapid-fire OpenAI calls).
 */

const windows = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  const timestamps = (windows.get(key) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0]!;
    const retryAfterMs = oldest + windowMs - now;
    windows.set(key, timestamps);
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(now);
  windows.set(key, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}
