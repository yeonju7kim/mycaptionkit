'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_SETTINGS,
  buildCaptionUrl,
  createServer,
  getModeForSpeakerLanguage,
  getModeDetails,
  normalizeSettings,
  parseCaptionSourceHtml,
  validateConfigPatch,
} = require('../server');

test('CaptionKit public page metadata is parsed for realtime captions', () => {
  const html = String.raw`{\"account_id\":\"d393f60b-ab2e-4052-9977-17af141a19a1\",\"slug\":\"kcic\"}{\"id\":\"profile-id\",\"account_id\":\"d393f60b-ab2e-4052-9977-17af141a19a1\",\"slug\":\"default\",\"settings\":{\"language\":\"en-US\"}}`;
  assert.deepEqual(parseCaptionSourceHtml(html), {
    accountId: 'd393f60b-ab2e-4052-9977-17af141a19a1',
    profileSlug: 'default',
    speakerLanguage: 'en-US',
    realtimeUrl: 'wss://realtime.shrill-base-ff6a.workers.dev/v1/subscribe',
  });
});

test('Speaker Language selects the opposite translation direction', () => {
  assert.equal(getModeForSpeakerLanguage('ko-KR', DEFAULT_SETTINGS), 'ko-en');
  assert.equal(getModeForSpeakerLanguage('en-US', DEFAULT_SETTINGS), 'en-ko');
  assert.equal(getModeForSpeakerLanguage('es', DEFAULT_SETTINGS), null);
});

test('한국어 설교 모드는 영어 번역 lower-third URL을 만든다', () => {
  const url = buildCaptionUrl({ ...DEFAULT_SETTINGS, activeMode: 'ko-en' });
  assert.equal(
    url,
    'https://captionkit.com/s/kcic-ytpx2u/l/en?width=80&rounded=true&fontSize=10&lines=1',
  );
});

test('기존 공통 화면 설정을 두 Display 설정으로 이전한다', () => {
  const migrated = normalizeSettings({
    handle: 'legacy-handle',
    width: 85,
    fontSize: 5,
    lineSpacing: 25,
    lines: 7,
    position: 'bottom',
    rounded: true,
    backgroundColor: '00000080',
  });
  assert.equal(migrated.displays.subtitle.width, 85);
  assert.equal(migrated.displays.full.width, 85);
  assert.equal(migrated.displays.subtitle.lines, 7);
  assert.equal(migrated.displays.full.lineSpacing, 25);
  assert.equal('width' in migrated, false);
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
    displays: {
      subtitle: {
        width: 95,
        fontSize: 12,
        lineSpacing: 35,
        lines: 10,
        position: 'top',
        backgroundColor: '#00000080',
      },
    },
  }), {
    displays: {
      subtitle: {
        width: 95,
        fontSize: 12,
        lineSpacing: 35,
        lines: 10,
        position: 'top',
        backgroundColor: '00000080',
      },
    },
  });

  assert.throws(() => validateConfigPatch({ displays: { full: { width: 101 } } }), /20 to 100/);
  assert.throws(() => validateConfigPatch({ displays: { full: { lineSpacing: 101 } } }), /0 to 100/);
  assert.throws(() => validateConfigPatch({ displays: { full: { lines: 11 } } }), /1 to 10/);
  assert.throws(() => validateConfigPatch({ handle: '../secret' }), /handle/);
});

test('로컬 서버가 Control, Display, 공개 상태를 제공한다', async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const [healthResponse, controlResponse, displayResponse, subtitleResponse, fullResponse, stateResponse] = await Promise.all([
    fetch(`${baseUrl}/health`),
    fetch(`${baseUrl}/control`),
    fetch(`${baseUrl}/display`),
    fetch(`${baseUrl}/display/subtitle`),
    fetch(`${baseUrl}/display/full`),
    fetch(`${baseUrl}/api/state`),
  ]);

  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true, service: 'mycaptionkit' });
  const controlHtml = await controlResponse.text();
  assert.doesNotMatch(controlHtml, /data-action="(?:start|stop)"/);
  assert.doesNotMatch(controlHtml, /Caption controls/);
  assert.match(controlHtml, /microphoneTestButton/);
  assert.match(controlHtml, /https:\/\/app\.captionkit\.com\//);
  assert.ok(controlHtml.indexOf('quick-start-panel') < controlHtml.indexOf('dashboard-grid'));
  assert.doesNotMatch(controlHtml, /class="panel microphone-panel"/);
  assert.match(controlHtml, /settings-microphone-actions/);
  assert.match(controlHtml, /data-guide-language="en"/);
  assert.match(controlHtml, /data-guide-language="ko"/);
  assert.match(controlHtml, /data-guide-language="zh"/);
  assert.match(controlHtml, /data-captionkit-dashboard-link/);
  assert.match(controlHtml, /Choose the Speaker Language\./);
  assert.match(controlHtml, /Press the ⚡ button\./);
  const displayHtml = await displayResponse.text();
  assert.match(displayHtml, /captionFrameA/);
  assert.match(displayHtml, /sentenceCaptionLayer/);
  assert.equal(subtitleResponse.status, 200);
  assert.equal(fullResponse.status, 200);
  assert.match(controlHtml, /data-display-address="subtitle"/);
  assert.match(controlHtml, /data-display-address="full"/);
  assert.match(controlHtml, /src="\/display\/subtitle\?preview=1"/);
  assert.match(controlHtml, /src="\/display\/full\?preview=1"/);

  const state = await stateResponse.json();
  assert.equal(state.ok, true);
  assert.equal(state.state.settings.handle, 'kcic-ytpx2u');
  assert.equal(Number.isInteger(state.state.settings.displays.subtitle.lines), true);
  assert.equal(Number.isInteger(state.state.settings.displays.full.lines), true);
  assert.equal('apiKey' in state.state.settings, false);
  assert.match(state.state.displayUrl, /^https:\/\/captionkit\.com\/s\//);
});
