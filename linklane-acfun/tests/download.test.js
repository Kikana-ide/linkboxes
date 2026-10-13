'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseProgressTime, assessMp4, describeFfmpegError } = require('../lib/download-check');

test('FFmpeg progress time parsed correctly', () => {
  assert.equal(parseProgressTime('00:06:38.500000'), 398.5);
  assert.equal(parseProgressTime('00:00:00.042667'), 0.042667);
  assert.ok(Number.isNaN(parseProgressTime('bad')));
});

test('reject the exact symptom observed in ac48742734: 2 KB and 0.043 seconds', () => {
  const r = assessMp4({ code: 0, bytes: 2022, seconds: 0.042667, expectedSeconds: 398 });
  assert.equal(r.ok, false);
  assert.match(r.message, /极少量数据/);
});

test('reject apparently large but substantially truncated MP4', () => {
  const r = assessMp4({ code: 0, bytes: 25 * 1024 * 1024, seconds: 80, expectedSeconds: 398 });
  assert.equal(r.ok, false);
  assert.match(r.message, /提前结束/);
});

test('allow a complete MP4 output', () => {
  assert.equal(assessMp4({ code: 0, bytes: 42 * 1024 * 1024, seconds: 397.8, expectedSeconds: 398 }).ok, true);
});

test('reject failed FFmpeg exits even if an output file exists', () => {
  assert.equal(assessMp4({ code: 1, bytes: 50 * 1024 * 1024, seconds: 200, expectedSeconds: 198 }).ok, false);
});

test('human-friendly errors do not reveal token URLs', () => {
  assert.match(describeFfmpegError('HTTP/1.1 403 Forbidden https://cdn.example/?secret=abc'), /403/);
});
