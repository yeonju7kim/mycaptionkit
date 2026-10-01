'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_SETTINGS,
  buildCaptionUrl,
  createServer,
  getModeDetails,
  parseCaptionSourceHtml,
  validateConfigPatch,
} = require('../server');

test('CaptionKit public page metadata is parsed for realtime captions', () => {
  const html = String.raw`{\"account_id\":\"d393f60b-ab2e-4052-9977-17af141a19a1\",\"slug\":\"kcic\"}{\"id\":\"profile-id\",\"account_id\":\"d393f60b-ab2e-4052-9977-17af141a19a1\",\"slug\":\"default\"}`;
  assert.deepEqual(parseCaptionSourceHtml(html), {
    accountId: 'd393f60b-ab2e-4052-9977-17af141a19a1',
    profileSlug: 'default',
    realtimeUrl: 'wss://realtime.shrill-base-ff6a.workers.dev/v1/subscribe',
  });
});

test('한국어 설교 모드는 영어 번역 lower-third URL을 만든다', () => {
  const url = buildCaptionUrl({ ...DEFAULT_SETTINGS, activeMode: 'ko-en' });
  assert.equal(
    url,
    'https://captionkit.com/s/kcic-ytpx2u/l/en?width=80&rounded=true&fontSize=10&lines=1',
  );
});

test('영어 설교 모드는 한국어 번역 화면을 선택한다', () => {
  const settings = { ...DEFAULT_SETTINGS, activeMode: 'en-ko' };
  assert.deepEqual(getModeDetails(settings), {
    id: 'en-ko',
    sourceLanguage: 'en-US',
    displayLanguage: 'ko',
    sourceLabel: 'English',
    displayLabel: 'Korean',
  });
  assert.match(buildCaptionUrl(settings), /\/l\/ko\?/);
});

test('화면 옵션을 검증하고 hex 색상의 #을 제거한다', () => {
  assert.deepEqual(validateConfigPatch({
    width: 95,
    fontSize: 12,
    lines: 5,
    position: 'top',
    backgroundColor: '#00000080',
  }), {
    width: 95,
    fontSize: 12,
    lines: 5,
    position: 'top',
    backgroundColor: '00000080',
  });

  assert.throws(() => validateConfigPatch({ width: 101 }), /20 to 100/);
  assert.throws(() => validateConfigPatch({ lines: 6 }), /1 to 5/);
  assert.throws(() => validateConfigPatch({ handle: '../secret' }), /handle/);
});

test('로컬 서버가 Control, Display, 공개 상태를 제공한다', async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const [healthResponse, controlResponse, displayResponse, stateResponse] = await Promise.all([
    fetch(`${baseUrl}/health`),
    fetch(`${baseUrl}/control`),
    fetch(`${baseUrl}/display`),
    fetch(`${baseUrl}/api/state`),
  ]);

  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true, service: 'mycaptionkit' });
  const controlHtml = await controlResponse.text();
  assert.match(controlHtml, /Korean → English/);
  assert.match(controlHtml, /English → Korean/);
  assert.match(controlHtml, /data-start-mode="ko-en"/);
  assert.match(controlHtml, /microphoneTestButton/);
  assert.match(controlHtml, /https:\/\/app\.captionkit\.com\//);
  const displayHtml = await displayResponse.text();
  assert.match(displayHtml, /captionFrameA/);
  assert.match(displayHtml, /sentenceCaptionLayer/);

  const state = await stateResponse.json();
  assert.equal(state.ok, true);
  assert.equal(state.state.settings.handle, 'kcic-ytpx2u');
  assert.equal('apiKey' in state.state.settings, false);
  assert.match(state.state.displayUrl, /^https:\/\/captionkit\.com\/s\//);
});
