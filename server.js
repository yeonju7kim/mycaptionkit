'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SETTINGS_FILE = path.join(ROOT_DIR, '.captionkit.local.json');
const SIGNAL_URL = 'https://api.captionkit.io/v2/signal';
const STATUS_URL = 'https://api.captionkit.com/v2/me/status';
const CAPTION_PAGE_URL = 'https://captionkit.com/s/';
const CAPTION_REALTIME_URL = 'wss://realtime.shrill-base-ff6a.workers.dev/v1/subscribe';

loadDotEnv(path.join(ROOT_DIR, '.env'));

const DEFAULT_SETTINGS = Object.freeze({
  handle: 'kcic-ytpx2u',
  activeMode: 'ko-en',
  koreanCode: 'ko',
  englishCode: 'en-US',
  width: 80,
  fontSize: 10,
  lines: 1,
  position: 'bottom',
  rounded: true,
  backgroundColor: '',
  apiKey: '',
});

let settings = loadSettings();
const runtime = {
  live: null,
  stream: null,
  lastAction: null,
  lastError: null,
  updatedAt: Date.now(),
};
const eventClients = new Set();
let captionSourceCache = null;

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Could not read the settings file; using defaults:', error.message);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings() {
  const temporaryFile = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, SETTINGS_FILE);
}

function getApiKey() {
  return (process.env.CAPTIONKIT_API_KEY || settings.apiKey || '').trim();
}

function getModeDetails(sourceSettings = settings) {
  if (sourceSettings.activeMode === 'en-ko') {
    return {
      id: 'en-ko',
      sourceLanguage: sourceSettings.englishCode,
      displayLanguage: sourceSettings.koreanCode,
      sourceLabel: 'English',
      displayLabel: 'Korean',
    };
  }

  return {
    id: 'ko-en',
    sourceLanguage: sourceSettings.koreanCode,
    // CaptionKit uses locale-specific codes (for example en-US) for speech
    // recognition, but its enabled English translation is exposed as `en`.
    displayLanguage: sourceSettings.englishCode.split('-')[0],
    sourceLabel: 'Korean',
    displayLabel: 'English',
  };
}

function buildCaptionUrl(sourceSettings = settings) {
  const mode = getModeDetails(sourceSettings);
  const handle = encodeURIComponent(sourceSettings.handle.trim());
  const language = encodeURIComponent(mode.displayLanguage.trim());
  const url = new URL(`https://captionkit.com/s/${handle}/l/${language}`);

  url.searchParams.set('width', String(sourceSettings.width));
  url.searchParams.set('rounded', String(sourceSettings.rounded));
  url.searchParams.set('fontSize', String(sourceSettings.fontSize));
  url.searchParams.set('lines', String(sourceSettings.lines));

  if (sourceSettings.position === 'top') {
    url.searchParams.set('position', 'top');
  }
  if (sourceSettings.backgroundColor) {
    url.searchParams.set('backgroundColor', sourceSettings.backgroundColor);
  }

  return url.toString();
}

function parseCaptionSourceHtml(html) {
  // Next.js serializes the public account data inside a script, escaping
  // quotes in some builds. Normalizing those quotes keeps this independent
  // of that transport detail.
  const normalized = String(html).replaceAll('\\"', '"');
  const accountMatch = normalized.match(/"account_id":"([0-9a-f-]{36})"/i);
  const profileMatch = normalized.match(/"id":"[^"]+","account_id":"[^"]+","slug":"([A-Za-z0-9_-]+)"/i);
  const languageMatch = normalized.match(/"settings":\{[^{}]*"language":"([A-Za-z0-9-]+)"/i);

  if (!accountMatch) throw httpError(502, 'Could not find the CaptionKit realtime account.');
  return {
    accountId: accountMatch[1],
    profileSlug: profileMatch?.[1] || 'default',
    speakerLanguage: languageMatch?.[1] || null,
    realtimeUrl: CAPTION_REALTIME_URL,
  };
}

async function fetchCaptionSource(forceRefresh = false) {
  const handle = settings.handle.trim();
  if (!forceRefresh && captionSourceCache?.handle === handle && captionSourceCache.expiresAt > Date.now()) {
    return captionSourceCache.value;
  }

  let response;
  try {
    response = await fetch(`${CAPTION_PAGE_URL}${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw httpError(502, `Could not load the CaptionKit display: ${error.message}`);
  }
  if (!response.ok) throw httpError(502, `CaptionKit display returned ${response.status}.`);

  const value = parseCaptionSourceHtml(await response.text());
  captionSourceCache = { handle, value, expiresAt: Date.now() + 10 * 60_000 };
  return value;
}

function getModeForSpeakerLanguage(language, sourceSettings = settings) {
  const baseLanguage = String(language || '').trim().toLowerCase().split('-')[0];
  const koreanBase = sourceSettings.koreanCode.toLowerCase().split('-')[0];
  const englishBase = sourceSettings.englishCode.toLowerCase().split('-')[0];
  if (baseLanguage === koreanBase) return 'ko-en';
  if (baseLanguage === englishBase) return 'en-ko';
  return null;
}

function syncModeFromSpeakerLanguage(language) {
  const detectedMode = getModeForSpeakerLanguage(language);
  if (!detectedMode) return null;
  if (settings.activeMode !== detectedMode) {
    settings.activeMode = detectedMode;
    persistSettings();
    broadcastState();
  }
  return detectedMode;
}

function speakerLanguageFromStatus(status) {
  return status?.inputLanguage ||
    status?.language ||
    status?.options?.language ||
    status?.status?.options?.language ||
    status?.stream?.options?.language ||
    null;
}

function publicState() {
  const { apiKey: _apiKey, ...safeSettings } = settings;
  return {
    settings: safeSettings,
    mode: getModeDetails(),
    displayUrl: buildCaptionUrl(),
    apiKeyConfigured: Boolean(getApiKey()),
    apiKeyFromEnvironment: Boolean((process.env.CAPTIONKIT_API_KEY || '').trim()),
    controlPinRequired: Boolean((process.env.CONTROL_PIN || '').trim()),
    runtime: { ...runtime },
  };
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const response of eventClients) response.write(payload);
}

function markRuntime(patch) {
  Object.assign(runtime, patch, { updatedAt: Date.now() });
  broadcastState();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateLanguageCode(value, fieldName) {
  if (typeof value !== 'string' || !/^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{2,8})?$/.test(value.trim())) {
    throw httpError(400, `${fieldName} is not a valid language code.`);
  }
  return value.trim();
}

function validateNumber(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw httpError(400, `${fieldName} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function validateConfigPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw httpError(400, 'Invalid settings payload.');
  }

  const validated = {};

  if ('handle' in patch) {
    const handle = String(patch.handle).trim();
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(handle)) {
      throw httpError(400, 'Check the CaptionKit handle.');
    }
    validated.handle = handle;
  }
  if ('koreanCode' in patch) {
    validated.koreanCode = validateLanguageCode(patch.koreanCode, 'Korean code');
  }
  if ('englishCode' in patch) {
    validated.englishCode = validateLanguageCode(patch.englishCode, 'English code');
  }
  if ('width' in patch) validated.width = validateNumber(patch.width, 'Width', 20, 100);
  if ('fontSize' in patch) validated.fontSize = validateNumber(patch.fontSize, 'Font size', 2, 30);
  if ('lines' in patch) validated.lines = validateNumber(patch.lines, 'Lines', 1, 5);

  if ('position' in patch) {
    if (!['top', 'bottom'].includes(patch.position)) {
      throw httpError(400, 'Position must be top or bottom.');
    }
    validated.position = patch.position;
  }
  if ('rounded' in patch) validated.rounded = Boolean(patch.rounded);

  if ('backgroundColor' in patch) {
    const color = String(patch.backgroundColor).trim();
    if (color.length > 80 || /[<>]/.test(color)) {
      throw httpError(400, 'Check the background color value.');
    }
    validated.backgroundColor = color.startsWith('#') ? color.slice(1) : color;
  }

  if (patch.clearApiKey === true) validated.apiKey = '';
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    if (patch.apiKey.trim().length > 500) throw httpError(400, 'The API key is too long.');
    validated.apiKey = patch.apiKey.trim();
  }

  return validated;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireControlPin(request) {
  const expectedPin = (process.env.CONTROL_PIN || '').trim();
  if (!expectedPin) return;

  const providedPin = String(request.headers['x-control-pin'] || '');
  if (providedPin !== expectedPin) {
    throw httpError(401, 'A valid Control PIN is required.');
  }
}

async function sendSignal(event, value) {
  const apiKey = getApiKey();
  if (!apiKey) throw httpError(400, 'Add a CaptionKit API key in Settings first.');

  const body = { event };
  if (value !== undefined) body.value = value;

  let response;
  try {
    response = await fetch(SIGNAL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw httpError(502, `Could not connect to CaptionKit: ${error.message}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw httpError(response.status === 401 ? 401 : 502,
      `CaptionKit signal failed (${response.status})${responseText ? `: ${responseText.slice(0, 180)}` : ''}`);
  }

  return responseText;
}

async function fetchStreamStatus() {
  const apiKey = getApiKey();
  if (!apiKey) throw httpError(400, 'Add a CaptionKit API key in Settings first.');

  let response;
  try {
    response = await fetch(STATUS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw httpError(502, `Could not check CaptionKit status: ${error.message}`);
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw httpError(response.status === 401 ? 401 : 502,
      `CaptionKit status check failed (${response.status})${responseText ? `: ${responseText.slice(0, 180)}` : ''}`);
  }

  return response.json();
}

async function performAction(action, requestedMode) {
  if (action === 'mode') {
    if (!['ko-en', 'en-ko'].includes(requestedMode)) {
      throw httpError(400, 'Unsupported translation mode.');
    }

    settings.activeMode = requestedMode;
    persistSettings();
    broadcastState();

    const mode = getModeDetails();
    await sendSignal('language:select', mode.sourceLanguage);
    markRuntime({
      lastAction: `Recognize ${mode.sourceLabel} · Display ${mode.displayLabel}`,
      lastError: null,
    });
    return;
  }

  // A language button can select its direction and start the stream in one
  // request, keeping the operator workflow to a single click.
  if (action === 'start' && requestedMode !== undefined) {
    if (!['ko-en', 'en-ko'].includes(requestedMode)) {
      throw httpError(400, 'Unsupported translation mode.');
    }
    settings.activeMode = requestedMode;
    persistSettings();
    broadcastState();
  }

  const signalMap = {
    start: 'captions:stream:start',
    stop: 'captions:stream:stop',
    clear: 'captions:stream:clear',
    hide: 'captions:visibility:hide',
    show: 'captions:visibility:show',
  };
  const event = signalMap[action];
  if (!event) throw httpError(400, 'Unsupported action.');

  // Without an explicit legacy mode, follow the Speaker Language selected in
  // CaptionKit. The start signal must not overwrite that dashboard choice.
  if (action === 'start') {
    if (requestedMode === undefined) {
      const source = await fetchCaptionSource(true);
      if (!syncModeFromSpeakerLanguage(source.speakerLanguage)) {
        throw httpError(400, 'Select Korean or English as Speaker Language in CaptionKit first.');
      }
    } else {
      await sendSignal('language:select', getModeDetails().sourceLanguage);
      await delay(800);
    }
  }
  await sendSignal(event);
  // A successful signal request only means CaptionKit accepted the command.
  // Wait for the status endpoint before presenting the stream as truly live.
  const livePatch = action === 'start' ? { live: null, stream: null } : action === 'stop' ? { live: false, stream: null } : {};
  markRuntime({ ...livePatch, lastAction: action, lastError: null });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(httpError(413, 'Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(httpError(400, 'Invalid JSON request.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendFile(response, fileName, contentType) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 500, { ok: false, error: 'Could not read the UI file.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const pathname = requestUrl.pathname;

  if (request.method === 'GET' && pathname === '/') {
    response.writeHead(302, { Location: '/control' });
    response.end();
    return;
  }
  if (request.method === 'GET' && pathname === '/control') {
    sendFile(response, 'control.html', 'text/html; charset=utf-8');
    return;
  }
  if (request.method === 'GET' && pathname === '/display') {
    sendFile(response, 'display.html', 'text/html; charset=utf-8');
    return;
  }

  const staticFiles = {
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/control.js': ['control.js', 'text/javascript; charset=utf-8'],
    '/display.js': ['display.js', 'text/javascript; charset=utf-8'],
  };
  if (request.method === 'GET' && staticFiles[pathname]) {
    sendFile(response, ...staticFiles[pathname]);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/state') {
    sendJson(response, 200, { ok: true, state: publicState() });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/caption-source') {
    sendJson(response, 200, { ok: true, source: await fetchCaptionSource() });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`data: ${JSON.stringify(publicState())}\n\n`);
    eventClients.add(response);
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
    request.on('close', () => {
      clearInterval(heartbeat);
      eventClients.delete(response);
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/status') {
    requireControlPin(request);
    let status;
    try {
      status = await fetchStreamStatus();
    } catch (error) {
      markRuntime({ lastError: error.message });
      throw error;
    }
    syncModeFromSpeakerLanguage(speakerLanguageFromStatus(status));
    markRuntime({
      live: Boolean(status.live),
      stream: status.status || null,
      lastError: null,
    });
    sendJson(response, 200, { ok: true, status, state: publicState() });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/config') {
    requireControlPin(request);
    const body = await readJsonBody(request);
    const patch = validateConfigPatch(body);
    settings = { ...settings, ...patch };
    persistSettings();
    markRuntime({ lastAction: 'settings', lastError: null });
    sendJson(response, 200, { ok: true, state: publicState() });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/action') {
    requireControlPin(request);
    const body = await readJsonBody(request);
    try {
      await performAction(body.action, body.mode);
      sendJson(response, 200, { ok: true, state: publicState() });
    } catch (error) {
      markRuntime({ lastError: error.message });
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'mycaptionkit' });
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Page not found.' });
}

function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, error.statusCode || 500, {
        ok: false,
        error: error.statusCode ? error.message : 'Server error.',
      });
      if (!error.statusCode) console.error(error);
    });
  });
}

function openBrowser(url) {
  let child;
  if (process.platform === 'win32') {
    child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
  child.unref();
}

function startServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT || 4173);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const server = createServer();

  server.on('error', (error) => {
    console.error('');
    if (error.code === 'EADDRINUSE') {
      console.error(`  포트 ${port}을 이미 다른 프로그램이 사용하고 있습니다.`);
      console.error('  My CaptionKit이 실행 중이라면 기존 Control 창을 사용해 주세요.');
      console.error('  다른 포트를 사용하려면 .env 파일의 PORT 값을 변경하세요.');
      process.exitCode = 2;
      return;
    }
    if (error.code === 'EACCES') {
      console.error(`  ${host}:${port} 주소를 열 권한이 없습니다.`);
      console.error('  .env 파일에서 1024보다 큰 PORT 값을 사용해 주세요.');
      process.exitCode = 3;
      return;
    }
    console.error(`  서버를 시작하지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const controlUrl = `http://${browserHost}:${port}/control`;
    console.log('');
    console.log('  My CaptionKit is ready');
    console.log(`  Control : ${controlUrl}`);
    console.log(`  Display : http://${browserHost}:${port}/display`);
    console.log('  Stop    : Ctrl+C');
    console.log('');

    if (process.argv.includes('--open')) openBrowser(controlUrl);
  });

  return server;
}

if (require.main === module) {
  const server = startServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  DEFAULT_SETTINGS,
  buildCaptionUrl,
  createServer,
  getModeForSpeakerLanguage,
  getModeDetails,
  parseCaptionSourceHtml,
  validateConfigPatch,
};
