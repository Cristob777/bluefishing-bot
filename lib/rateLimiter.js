const buckets = new Map();
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 300000);
const MAX_MESSAGES = Number(process.env.RATE_LIMIT_MAX_MESSAGES || 30);

function allowMessage(key) {
  const now = Date.now();
  const bucket = buckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start >= WINDOW_MS) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10000) {
    for (const [k, value] of buckets) if (now - value.start >= WINDOW_MS * 2) buckets.delete(k);
  }
  return bucket.count <= MAX_MESSAGES;
}

module.exports = { allowMessage };
