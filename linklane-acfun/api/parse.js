'use strict';
const { getVideo, publicVideo, PublicError } = require('../lib/acfun');
const { allow } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '请使用 POST 请求。' });
  }
  if (!allow(req, 'parse', 15, 60_000)) return res.status(429).json({ error: '请求过于频繁，请稍后再试。' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const video = await getVideo(body?.url);
    return res.status(200).json({ success: true, video: publicVideo(video) });
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 400;
    return res.status(status).json({ error: error instanceof PublicError ? error.message : '请求格式错误。' });
  }
};
