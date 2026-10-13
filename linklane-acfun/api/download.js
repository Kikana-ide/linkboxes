'use strict';
const { spawn } = require('node:child_process');
const { getVideo, PublicError, USER_AGENT } = require('../lib/acfun');
const { allow } = require('../lib/rate-limit');

function getFfmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('ffmpeg-static') || 'ffmpeg'; }
  catch (_) { return 'ffmpeg'; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '请使用 GET 请求。' });
  }
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return res.status(403).json({ error: '不允许跨站调用下载接口。' });
  if (!allow(req, 'download', 5, 10 * 60_000)) return res.status(429).json({ error: '下载过于频繁，请稍后再试。' });

  let video;
  let stream;
  try {
    const current = new URL(req.url, 'https://example.local');
    video = await getVideo(current.searchParams.get('video') || '');
    const iRaw = current.searchParams.get('quality');
    const i = Number(iRaw);
    if (!/^\d+$/.test(iRaw || '') || !Number.isSafeInteger(i) || i >= video.streams.length) {
      throw new PublicError('无效的画质选项。');
    }
    if (video.duration != null && video.duration > 1800) {
      throw new PublicError('当前版本只支持转换 30 分钟以内的视频。较长视频请使用本地下载工具。', 422);
    }
    stream = video.streams[i];
  } catch (error) {
    return res.status(error instanceof PublicError ? error.status : 500)
      .json({ error: error instanceof PublicError ? error.message : '视频下载准备失败。' });
  }

  const filename = `${video.id}-${stream.label.replace(/[^a-zA-Z0-9\-]/g, '') || 'video'}.mp4`;
  const ffmpeg = getFfmpegBinary();
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-user_agent', USER_AGENT,
    '-headers', 'Referer: https://www.acfun.cn/\r\nOrigin: https://www.acfun.cn\r\n',
    '-rw_timeout', '12000000',
    '-i', stream.url,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1'
  ];

  let child;
  try {
    child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_) {
    return res.status(500).json({ error: '视频转换服务暂时不可用（FFmpeg 未启动）。' });
  }

  let stderr = '';
  let ended = false;
  const kill = () => { if (child && !child.killed) child.kill('SIGKILL'); };
  const timer = setTimeout(kill, 275_000);
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1500); });
  child.on('error', error => {
    clearTimeout(timer);
    if (ended) return;
    ended = true;
    if (!res.headersSent) res.status(500).json({ error: 'FFmpeg 启动失败，请检查部署环境。' });
    else res.destroy(error);
  });
  child.on('close', code => {
    clearTimeout(timer);
    if (ended) return;
    ended = true;
    if (code !== 0 && !res.headersSent) {
      res.status(502).json({ error: '视频流转换失败。源站可能限制了访问或流已过期。' });
    } else if (code !== 0 && !res.writableEnded) {
      res.destroy(new Error('FFmpeg 转换中断: ' + stderr.slice(0, 120)));
    } else if (!res.writableEnded) res.end();
  });
  res.on('close', () => { if (!res.writableEnded && !ended) kill(); });
  req.on('aborted', kill);

  // Binary output is streamed rather than buffered (avoids function payload limit).
  // A header-only MP4 fragment may still be emitted before an upstream failure.
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Accel-Buffering': 'no',
    'Cache-Control': 'private, no-store'
  });
  child.stdout.pipe(res);
};
