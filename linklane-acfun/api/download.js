'use strict';

// Reliability-first MP4 downloads for Vercel Functions.
// IMPORTANT: never send a 200/video/mp4 response before FFmpeg has finished
// and the resulting duration has been checked. Otherwise a failed HLS request
// can be downloaded as a tiny but technically valid MP4 file.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { getVideo, PublicError, USER_AGENT } = require('../lib/acfun');
const { allow } = require('../lib/rate-limit');
const { assessMp4, parseProgressTime, describeFfmpegError } = require('../lib/download-check');

const TIMEOUT_MS = 220_000;
const MAX_MP4_BYTES = 390 * 1024 * 1024; // keep below typical ephemeral /tmp capacity
const MAX_VIDEO_SECONDS = 1800;

function getFfmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('ffmpeg-static') || 'ffmpeg'; }
  catch (_) { return 'ffmpeg'; }
}

async function runFfmpeg(url, file, expectedDuration) {
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
    '-user_agent', USER_AGENT,
    '-headers', 'Referer: https://www.acfun.cn/\r\nOrigin: https://www.acfun.cn\r\n',
    '-rw_timeout', '15000000',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
    '-i', url,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
    // Output to a regular file, not a fragmented MP4 pipe. Browsers should
    // not see an incomplete MP4 as a successful HTTP 200 response.
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', '-f', 'mp4', file
  ];
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(getFfmpegBinary(), args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(new Error('FFmpeg 无法启动')); return; }

    let stderr = '';
    let progress = '';
    let lastTime = 0;
    let timedOut = false;
    let tooLarge = false;
    let completed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    const sizeTimer = setInterval(() => {
      fs.stat(file, (error, stat) => {
        if (!completed && !error && stat.size > MAX_MP4_BYTES) {
          tooLarge = true;
          child.kill('SIGKILL');
        }
      });
    }, 1500);
    const cleanup = () => {
      completed = true;
      clearTimeout(timer);
      clearInterval(sizeTimer);
    };
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4500); });
    child.stdout.on('data', chunk => {
      progress += chunk.toString();
      let newline;
      while ((newline = progress.indexOf('\n')) >= 0) {
        const line = progress.slice(0, newline).trim();
        progress = progress.slice(newline + 1);
        if (line.startsWith('out_time=')) {
          const seconds = parseProgressTime(line.slice('out_time='.length));
          if (Number.isFinite(seconds)) lastTime = Math.max(lastTime, seconds);
        }
      }
      if (progress.length > 1000) progress = progress.slice(-1000);
    });
    child.once('error', error => { cleanup(); reject(new Error(`FFmpeg 启动失败：${error.code || 'unknown'}`)); });
    child.once('close', async (code) => {
      if (completed) return;
      cleanup();
      if (timedOut) { reject(new PublicError('视频转换超时。Vercel 免费服务无法稳定转换此视频，请稍后重试或改用本地工具。', 504)); return; }
      if (tooLarge) { reject(new PublicError('视频文件过大，超过当前免费服务临时存储限制。', 413)); return; }
      let bytes = 0;
      try { bytes = (await fsp.stat(file)).size; } catch (_) { /* file does not exist */ }
      const assessment = assessMp4({ code, bytes, seconds: lastTime, expectedSeconds: expectedDuration });
      if (!assessment.ok) {
        const safeHost = (() => { try { return new URL(url).hostname; } catch (_) { return 'unknown'; } })();
        console.error('[Linkbox AcFun download failure]', {
          sourceHost: safeHost,
          ffmpegCode: code,
          outputBytes: bytes,
          outputSeconds: Number(lastTime.toFixed(3)),
          expectedSeconds: expectedDuration,
          // Signed CDN URLs can contain access tokens: redact them before logging.
          ffmpegError: stderr.replace(/https?:\/\/\S+/gi, '[REDACTED_URL]').slice(-700)
        });
        const hint = describeFfmpegError(stderr);
        // Error messages never contain the signed AcFun CDN URL.
        reject(new PublicError(`${assessment.message}${hint ? ` ${hint}` : ''}`, 502));
      } else {
        resolve({ bytes, seconds: lastTime });
      }
    });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '请使用 GET 请求。' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '不允许跨站调用下载接口。' });
  if (!allow(req, 'download', 5, 10 * 60_000)) return res.status(429).json({ error: '下载过于频繁，请稍后再试。' });

  let tempDir;
  try {
    const current = new URL(req.url, 'https://example.local');
    const video = await getVideo(current.searchParams.get('video') || '');
    const raw = current.searchParams.get('quality');
    const index = Number(raw);
    if (!/^\d+$/.test(raw || '') || !Number.isSafeInteger(index) || index >= video.streams.length) {
      throw new PublicError('无效的画质选项。');
    }
    if (video.duration != null && video.duration > MAX_VIDEO_SECONDS) {
      throw new PublicError('当前版本仅支持 30 分钟以内的视频，较长视频请使用本地下载工具。', 422);
    }
    const stream = video.streams[index];
    const filename = `${video.id}-${stream.label.replace(/[^a-zA-Z0-9-]/g, '') || 'video'}.mp4`;
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linkbox-mp4-'));
    const output = path.join(tempDir, 'result.mp4');

    // The 200 response happens only AFTER complete conversion and verification.
    const result = await runFfmpeg(stream.url, output, video.duration);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(result.bytes),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store'
    });
    await pipeline(fs.createReadStream(output), res);
  } catch (error) {
    if (!res.headersSent) {
      const status = error instanceof PublicError ? error.status : 500;
      res.status(status).json({ error: error instanceof PublicError ? error.message : '视频转换服务器发生错误。请稍后再试。' });
    } else if (!res.destroyed) {
      res.destroy(error);
    }
  } finally {
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};
