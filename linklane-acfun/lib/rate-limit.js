'use strict';
// Lightweight per-instance limiter. For public/high-traffic sites use a persistent
// rate-limit store such as Upstash Redis; serverless instances do not share memory.
const buckets = new Map();
function allow(req, key, limit, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const token = `${key}:${ip}`;
  const previous = buckets.get(token) || [];
  const current = previous.filter((time) => now - time < windowMs);
  if (current.length >= limit) return false;
  current.push(now);
  buckets.set(token, current);
  if (buckets.size > 2500) {
    for (const [k, times] of buckets) {
      if (!times.some((time) => now - time < windowMs)) buckets.delete(k);
    }
  }
  return true;
}
module.exports = { allow };
