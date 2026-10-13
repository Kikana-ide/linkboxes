const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVideoId, findVideoInfo, parsePage, PublicError, publicVideo } = require('../lib/acfun');

const content = {
  title: '测试 { "引号" } 视频',
  coverUrl: 'https://cdn.example.com/cover.jpg',
  user: { name: '测试 UP' },
  videoList: [{ id: 123 }],
  currentVideoInfo: {
    durationMillis: 73210,
    ksPlayJson: JSON.stringify({ adaptationSet: [{ representation: [
      { height: 720, width: 1280, qualityType: 'HD', url: 'https://cdn.example.com/720.m3u8' },
      { height: 1080, width: 1920, qualityType: 'FULL_HD', url: 'https://cdn.example.com/1080.m3u8' }
    ] }] })
  }
};
const html = `<script>window.pageInfo = window.videoInfo = ${JSON.stringify(content)};</script>`;

test('normalize AcFun URLs, allow only AcFun paths', () => {
  assert.equal(normalizeVideoId('https://www.acfun.cn/v/ac35457073'), 'ac35457073');
  assert.equal(normalizeVideoId('ac35457073_2'), 'ac35457073_2');
  assert.throws(() => normalizeVideoId('https://evil.test/v/ac35457073'), PublicError);
  assert.throws(() => normalizeVideoId('http://127.0.0.1/v/ac1'), PublicError);
});
test('balanced parser handles nested braces, quotes and escapes', () => {
  assert.deepEqual(findVideoInfo(html), content);
});
test('parser lists streams by highest resolution and redacts stream URLs', () => {
  const v = parsePage(html, 'ac35457073');
  assert.equal(v.title, content.title);
  assert.equal(v.duration, 73);
  assert.equal(v.streams[0].label, '1080P');
  assert.equal(v.streams[1].height, 720);
  const pub = publicVideo(v);
  assert.equal(pub.streams[0].url, undefined);
  assert.equal(pub.streams[0].index, 0);
});
test('parser rejects missing stream data', () => {
  assert.throws(() => parsePage('<html>no video info</html>', 'ac123'), PublicError);
});
