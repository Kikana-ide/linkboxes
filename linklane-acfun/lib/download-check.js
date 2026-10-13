'use strict';

/** Parse FFmpeg `-progress` output out_time=HH:MM:SS.microseconds */
function parseProgressTime(value) {
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(value));
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || '0'}`);
}

/** Prevent tiny/truncated MP4s being presented as completed downloads. */
function assessMp4({ code, bytes, seconds, expectedSeconds }) {
  if (code !== 0) return { ok: false, message: 'FFmpeg 转换未完成，下载已停止。' };
  if (!Number.isFinite(bytes) || bytes < 128 * 1024) {
    return { ok: false, message: `源站只返回了极少量数据（${Math.round((bytes || 0) / 1024)} KB），拒绝生成损坏的 MP4。` };
  }
  if (!Number.isFinite(seconds) || seconds < 0.5) {
    return { ok: false, message: '没有获得有效的视频内容，MP4 下载已取消。' };
  }
  if (Number.isFinite(expectedSeconds) && expectedSeconds > 0) {
    const min = Math.max(0.5, expectedSeconds * 0.9 - 1);
    if (seconds < min) {
      return { ok: false, message: `视频流提前结束：实际仅 ${seconds.toFixed(1)} 秒，原视频约 ${expectedSeconds} 秒。已拦截不完整的 MP4。` };
    }
  }
  return { ok: true };
}

function describeFfmpegError(stderr) {
  const text = String(stderr || '');
  if (/403|Forbidden/i.test(text)) return '源站 CDN 返回了 403（访问被拒绝）。';
  if (/404|Not Found/i.test(text)) return '视频分片不存在或播放地址已过期。';
  if (/timed out|timeout/i.test(text)) return '读取视频源时发生超时。';
  if (/Invalid data|Error when loading first segment|Invalid argument/i.test(text)) return '视频流格式或分片数据异常。';
  return '';
}

module.exports = { parseProgressTime, assessMp4, describeFfmpegError };
