'use strict';

const frames = [
  document.querySelector('#captionFrameA'),
  document.querySelector('#captionFrameB'),
];
const sentenceLayer = document.querySelector('#sentenceCaptionLayer');
const sentenceList = document.querySelector('#sentenceCaptionList');
const debugPanel = document.querySelector('#displayDebug');
const debugText = document.querySelector('#displayDebugText');
const displayParams = new URLSearchParams(window.location.search);
const debugEnabled = displayParams.get('debug') === '1';
const replayAll = displayParams.get('replay') === 'all';

let activeFrameIndex = 0;
let currentCaptionUrl = '';
let loadSequence = 0;
let currentState = null;
let captionSocket = null;
let socketKey = '';
let reconnectTimer = null;
let reconnectDelay = 1000;
let heartbeatTimer = null;
let completedCaptions = [];
let partialCaption = null;
const seenCaptions = new Set();

if (debugEnabled) debugPanel.hidden = false;

function setDebug(message, connected = true) {
  if (!debugEnabled) return;
  debugText.textContent = message;
  debugPanel.querySelector('.status-dot').style.background = connected ? '#31d695' : '#ff6572';
}

function switchCaptionUrl(url) {
  if (!url || url === currentCaptionUrl) return;
  currentCaptionUrl = url;
  const sequence = ++loadSequence;

  if (!frames[activeFrameIndex].src || frames[activeFrameIndex].src === 'about:blank') {
    frames[activeFrameIndex].src = url;
    return;
  }

  const nextFrameIndex = activeFrameIndex === 0 ? 1 : 0;
  const previousFrame = frames[activeFrameIndex];
  const nextFrame = frames[nextFrameIndex];
  let activated = false;
  nextFrame.src = url;

  const activate = () => {
    if (activated || sequence !== loadSequence) return;
    activated = true;
    nextFrame.classList.add('is-active');
    previousFrame.classList.remove('is-active');
    activeFrameIndex = nextFrameIndex;
    setTimeout(() => {
      if (previousFrame !== frames[activeFrameIndex]) previousFrame.src = 'about:blank';
    }, 250);
  };

  nextFrame.addEventListener('load', activate, { once: true });
  setTimeout(activate, 3500);
}

function backgroundValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return 'rgba(0, 0, 0, 0.78)';
  if (/^[0-9a-f]{3,8}$/i.test(value)) return `#${value}`;
  return value;
}

function applyDisplaySettings(settings) {
  sentenceLayer.style.setProperty('--caption-width', `${settings.width}%`);
  sentenceLayer.style.setProperty('--caption-font-size', `${settings.fontSize}vh`);
  sentenceLayer.style.setProperty('--caption-background', backgroundValue(settings.backgroundColor));
  sentenceLayer.classList.toggle('is-top', settings.position === 'top');
  sentenceLayer.classList.toggle('is-square', !settings.rounded);
}

function captionKey(caption) {
  if (caption.requestId !== undefined && caption.index !== undefined) {
    return `${caption.requestId}:${caption.index}`;
  }
  return `${caption.ts || caption.t || ''}:${caption.text || ''}`;
}

function renderCaptions() {
  const limit = Number(currentState?.settings?.lines) || 1;
  const visible = completedCaptions.slice(-(partialCaption ? Math.max(0, limit - 1) : limit));
  if (partialCaption?.text?.trim()) visible.push({ ...partialCaption, partial: true });

  sentenceList.replaceChildren(...visible.map((caption) => {
    const line = document.createElement('div');
    line.className = `sentence-caption${caption.partial ? ' is-partial' : ''}`;
    line.textContent = caption.text.trim();
    return line;
  }));
}

function acceptCaption(caption, isFinal) {
  if (!caption || typeof caption.text !== 'string' || !caption.text.trim()) return;

  if (!isFinal && !caption.isComplete) {
    partialCaption = caption;
    renderCaptions();
    return;
  }

  const key = captionKey(caption);
  partialCaption = null;
  if (seenCaptions.has(key)) {
    renderCaptions();
    return;
  }
  seenCaptions.add(key);
  completedCaptions.push(caption);
  if (completedCaptions.length > 30) completedCaptions = completedCaptions.slice(-30);
  if (seenCaptions.size > 200) {
    seenCaptions.clear();
    for (const item of completedCaptions) seenCaptions.add(captionKey(item));
  }
  renderCaptions();
}

function closeCaptionSocket() {
  clearTimeout(reconnectTimer);
  clearInterval(heartbeatTimer);
  reconnectTimer = null;
  heartbeatTimer = null;
  if (captionSocket) {
    const socket = captionSocket;
    captionSocket = null;
    socket.onclose = null;
    socket.close();
  }
}

function buildSocketUrl(source, channel) {
  const url = new URL(source.realtimeUrl);
  const cursorName = `last_ack_${channel}`;
  url.searchParams.append('channel', channel);
  // Restore only very recent captions after a browser refresh.
  url.searchParams.set(cursorName, replayAll ? '0' : String(Date.now() - 15_000));
  return url.toString();
}

function openCaptionSocket(source, channel, key) {
  if (key !== socketKey) return;
  closeCaptionSocket();
  const socket = new WebSocket(buildSocketUrl(source, channel));
  captionSocket = socket;
  setDebug('Connecting to captions', false);

  socket.onopen = () => {
    if (socket !== captionSocket) return;
    reconnectDelay = 1000;
    sentenceLayer.classList.add('is-active');
    frames.forEach((frame) => frame.classList.add('is-fallback-hidden'));
    setDebug('Sentence captions connected');
    heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, 25_000);
  };

  socket.onmessage = (event) => {
    if (event.data === 'pong') return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.channel !== channel || !message.data) return;
    if (Array.isArray(message.data)) {
      for (const caption of message.data) acceptCaption(caption, message.event === 'transcription.final');
      return;
    }
    if (message.event === 'transcription.final' || message.event === 'transcription.partial') {
      acceptCaption(message.data, message.event === 'transcription.final');
    }
  };

  socket.onclose = () => {
    if (socket !== captionSocket) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    captionSocket = null;
    setDebug('Caption connection retrying', false);
    reconnectTimer = setTimeout(() => openCaptionSocket(source, channel, key), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  };

  socket.onerror = () => setDebug('Caption connection error', false);
}

async function connectCaptionStream(state) {
  const language = state.mode.id === 'ko-en'
    ? state.settings.englishCode
    : state.settings.koreanCode;
  const nextKey = `${state.settings.handle}:${language}`;
  if (nextKey === socketKey && captionSocket) return;

  socketKey = nextKey;
  closeCaptionSocket();
  completedCaptions = [];
  partialCaption = null;
  seenCaptions.clear();
  renderCaptions();

  try {
    const response = await fetch('/api/caption-source', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Caption source unavailable');
    if (nextKey !== socketKey) return;
    const channel = `${payload.source.accountId}:${payload.source.profileSlug}:captions:${language}`;
    openCaptionSocket(payload.source, channel, nextKey);
  } catch (error) {
    sentenceLayer.classList.remove('is-active');
    frames.forEach((frame) => frame.classList.remove('is-fallback-hidden'));
    setDebug(error.message, false);
  }
}

function applyState(state) {
  if (!state) return;
  currentState = state;
  if (state.displayUrl) switchCaptionUrl(state.displayUrl);
  applyDisplaySettings(state.settings);
  renderCaptions();
  connectCaptionStream(state);
}

async function initialize() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    const payload = await response.json();
    applyState(payload.state);
  } catch {
    setDebug('Could not load local settings', false);
  }

  const events = new EventSource('/api/events');
  events.onopen = () => setDebug('Local server connected');
  events.onmessage = (event) => {
    try {
      applyState(JSON.parse(event.data));
    } catch {
      setDebug('Invalid local state', false);
    }
  };
  events.onerror = () => setDebug('Local server reconnecting', false);
}

window.addEventListener('beforeunload', closeCaptionSocket);
initialize();
