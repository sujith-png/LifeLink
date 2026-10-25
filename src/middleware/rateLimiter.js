// Lightweight in-memory sliding window rate limiter
const ipRequestCounts = new Map();
const phoneRequestCounts = new Map();

function cleanOldEntries(map, windowMs) {
  const now = Date.now();
  for (const [key, timestamps] of map.entries()) {
    const valid = timestamps.filter(t => now - t < windowMs);
    if (valid.length === 0) {
      map.delete(key);
    } else {
      map.set(key, valid);
    }
  }
}

// Global cleanup every 5 minutes
setInterval(() => {
  cleanOldEntries(ipRequestCounts, 15 * 60 * 1000);
  cleanOldEntries(phoneRequestCounts, 60 * 60 * 1000);
}, 5 * 60 * 1000).unref();

function createRateLimiter({ windowMs = 60 * 1000, max = 30, message = 'Too many requests, please try again later.' }) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    const timestamps = ipRequestCounts.get(ip) || [];
    const validTimestamps = timestamps.filter(t => now - t < windowMs);

    if (validTimestamps.length >= max) {
      return res.status(429).json({
        success: false,
        message,
        retryAfterSeconds: Math.ceil((validTimestamps[0] + windowMs - now) / 1000)
      });
    }

    validTimestamps.push(now);
    ipRequestCounts.set(ip, validTimestamps);
    next();
  };
}

// Specialized rate limiter for emergency request postings per phone number
function phoneRateLimiter(req, res, next) {
  const phone = (req.body.contact_phone || req.body.phone || '').replace(/[\s-]/g, '');
  if (!phone) return next();

  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const max = 3; // Max 3 requests per hour per phone

  const timestamps = phoneRequestCounts.get(phone) || [];
  const validTimestamps = timestamps.filter(t => now - t < windowMs);

  if (validTimestamps.length >= max) {
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded: You have posted the maximum allowed emergency requests (3 per hour) for this phone number.'
    });
  }

  validTimestamps.push(now);
  phoneRequestCounts.set(phone, validTimestamps);
  next();
}

module.exports = {
  createRateLimiter,
  phoneRateLimiter
};
