'use strict';
const fs = require('node:fs');
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let ffmpeg = process.env.FFMPEG_PATH || null;
  if (!ffmpeg) {
    try { ffmpeg = require('ffmpeg-static'); } catch (_) { /* no ffmpeg */ }
  }
  return res.status(200).json({ status: 'ok', ffmpegAvailable: !!ffmpeg && fs.existsSync(ffmpeg) });
};
