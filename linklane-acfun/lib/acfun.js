'use strict';

const AC_URL_RE = /^https?:\/\/(?:www\.|m\.)?acfun\.cn\/v\/(ac\d{1,16}(?:_\d{1,5})?)(?:[/?#].*)?$/i;
const AC_ID_RE = /^ac\d{1,16}(?:_\d{1,5})?$/i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class PublicError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function normalizeVideoId(input) {
  if (typeof input !== 'string' || input.length > 600) {
    throw new PublicError('请输入有效的 AcFun 视频链接。');
  }
  const value = input.trim();
  const id = AC_ID_RE.test(value) ? value : AC_URL_RE.exec(value)?.[1];
  if (!id) {
    throw new PublicError('仅支持 AcFun 公开视频链接，例如 https://www.acfun.cn/v/ac35457073。');
  }
  return id.toLowerCase();
}

/** Extract a JSON object assigned to window.videoInfo (balanced scanner; no eval). */
function findVideoInfo(html) {
  const pattern = /window\.(?:videoInfo|pageInfo)\s*=/g;
  let found;
  while ((found = pattern.exec(html)) !== null) {
    const first = html.indexOf('{', found.index + found[0].length);
    if (first < 0 || first - found.index > 180) continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = first; i < html.length; i++) {
      const c = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(html.slice(first, i + 1));
            if (parsed && typeof parsed === 'object' && parsed.currentVideoInfo) return parsed;
          } catch (_) {
            // Another assignment may contain the usable JSON.
          }
          break;
        }
      }
    }
  }
  throw new PublicError('未能在 AcFun 页面中找到公开视频信息。视频可能已下架、需要登录，或平台更新了页面结构。', 422);
}

function qualityLabel(stream) {
  const type = String(stream.qualityLabel || stream.qualityType || stream.quality || '').trim();
  if (/\d{3,4}\s*[pP]/.test(type)) return type.toUpperCase().replace(/\s+/g, '');
  const aliases = {
    UHD: '4K', FOUR_K: '4K', '4K': '4K', BLUE_RAY: '蓝光', BLU_RAY: '蓝光',
    FULL_HD: '1080P', FHD: '1080P', SUPER_HD: '1080P', HD: '720P',
    HIGH: '高清', NORMAL: '标清', STANDARD: '标清', SD: '480P'
  };
  if (aliases[type.toUpperCase()]) return aliases[type.toUpperCase()];
  const height = Number(stream.height);
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080P';
  if (height >= 720) return '720P';
  if (height >= 480) return '480P';
  return type || '自动画质';
}

function parsePage(html, id) {
  const info = findVideoInfo(html);
  const current = info.currentVideoInfo || {};
  let play;
  try {
    play = typeof current.ksPlayJson === 'string'
      ? JSON.parse(current.ksPlayJson)
      : current.ksPlayJson;
  } catch (_) {
    throw new PublicError('视频的播放信息格式无法解析。', 422);
  }
  if (!play?.adaptationSet || !Array.isArray(play.adaptationSet)) {
    throw new PublicError('没有找到可公开访问的视频流。此工具不支持付费或受保护的视频。', 422);
  }

  const all = play.adaptationSet.flatMap((item) => Array.isArray(item.representation) ? item.representation : []);
  const streams = [];
  const seen = new Set();
  for (const entry of all) {
    if (!entry || typeof entry.url !== 'string') continue;
    let streamUrl;
    try {
      streamUrl = new URL(entry.url.startsWith('//') ? `https:${entry.url}` : entry.url);
    } catch (_) { continue; }
    if (streamUrl.protocol !== 'https:' && streamUrl.protocol !== 'http:') continue;
    if (seen.has(streamUrl.href)) continue;
    seen.add(streamUrl.href);
    streams.push({
      label: qualityLabel(entry),
      height: Number(entry.height) || null,
      width: Number(entry.width) || null,
      bitrate: Number(entry.avgBitrate) || null,
      mime: /\.mp4(?:\?|$)/i.test(streamUrl.pathname) ? 'mp4' : 'hls',
      url: streamUrl.href
    });
  }
  if (!streams.length) throw new PublicError('当前视频没有找到可用的公开视频流。', 422);
  streams.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  const durationMillis = Number(current.durationMillis);
  const durationSeconds = Number(current.duration);
  const duration = Number.isFinite(durationMillis) && durationMillis > 0
    ? Math.round(durationMillis / 1000)
    : (Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null);

  return {
    id,
    url: `https://www.acfun.cn/v/${id}`,
    title: String(info.title || current.title || `AcFun 视频 ${id}`).slice(0, 300),
    cover: typeof info.coverUrl === 'string' && /^https?:\/\//.test(info.coverUrl) ? info.coverUrl : null,
    uploader: String(info.user?.name || 'AcFun UP 主').slice(0, 80),
    duration,
    parts: Array.isArray(info.videoList) ? info.videoList.length : 1,
    streams
  };
}

async function getVideo(input) {
  const id = normalizeVideoId(input);
  const target = `https://www.acfun.cn/v/${id}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        'Referer': 'https://www.acfun.cn/'
      }
    });
    if (!response.ok) {
      throw new PublicError(`AcFun 页面暂时不可访问（HTTP ${response.status}）。可能是视频权限或平台访问限制。`, 502);
    }
    if (Number(response.headers.get('content-length')) > 5_000_000) {
      throw new PublicError('视频页面体积异常，解析已终止。', 422);
    }
    const html = await response.text();
    if (html.length > 5_000_000) throw new PublicError('视频页面体积异常，解析已终止。', 422);
    return parsePage(html, id);
  } catch (error) {
    if (error instanceof PublicError) throw error;
    if (error?.name === 'AbortError') throw new PublicError('连接 AcFun 超时，请稍后重试。', 504);
    throw new PublicError('无法访问 AcFun 网站，请稍后再试。', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function publicVideo(video) {
  return {
    ...video,
    streams: video.streams.map(({url, ...stream}, index) => ({ ...stream, index }))
  };
}

module.exports = { normalizeVideoId, findVideoInfo, parsePage, getVideo, publicVideo, PublicError, USER_AGENT };
