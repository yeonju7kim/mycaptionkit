'use strict';

const elements = {
  livePill: document.querySelector('#livePill'),
  liveLabel: document.querySelector('#liveLabel'),
  setupNotice: document.querySelector('#setupNotice'),
  captionkitDashboardLinks: document.querySelectorAll('[data-captionkit-dashboard-link]'),
  quickStartTitle: document.querySelector('#quickStartTitle'),
  quickStartSteps: document.querySelector('.quick-start-steps'),
  quickStartStepItems: document.querySelectorAll('[data-guide-step-item]'),
  quickStartStepLabels: document.querySelectorAll('[data-guide-step]'),
  guideModeButtons: document.querySelectorAll('[data-guide-mode]'),
  guideLanguageButtons: document.querySelectorAll('[data-guide-language]'),
  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  toast: document.querySelector('#toast'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyHelp: document.querySelector('#apiKeyHelp'),
  handleInput: document.querySelector('#handleInput'),
  controlPinInput: document.querySelector('#controlPinInput'),
  koreanCodeInput: document.querySelector('#koreanCodeInput'),
  englishCodeInput: document.querySelector('#englishCodeInput'),
  microphoneDot: document.querySelector('#microphoneDot'),
  microphoneStatus: document.querySelector('#microphoneStatus'),
  microphoneLevel: document.querySelector('#microphoneLevel'),
  microphoneLevelBar: document.querySelector('#microphoneLevelBar'),
  microphoneDeviceSelect: document.querySelector('#microphoneDeviceSelect'),
  microphoneTestButton: document.querySelector('#microphoneTestButton'),
};

const PIN_STORAGE_KEY = 'mycaptionkit-control-pin';
const MIC_DEVICE_STORAGE_KEY = 'mycaptionkit-microphone-device';
const GUIDE_LANGUAGE_STORAGE_KEY = 'mycaptionkit-guide-language';
const GUIDE_MODE_STORAGE_KEY = 'mycaptionkit-guide-mode';
const DISPLAY_TYPES = ['subtitle', 'full'];
const GUIDE_COPY = {
  en: {
    start: {
      title: 'How to start AI translation',
      steps: [
        'Open CaptionKit',
        'Find Caption Controls on the right. (Click Broadcast if hidden.)',
        'Choose Speaker Language.',
        'Press ⚡ to start.',
      ],
    },
    change: {
      title: 'How to change Speaker Language',
      steps: [
        'Open CaptionKit',
        'Find Caption Controls on the right. (Click Broadcast if hidden.)',
        'Stop translation.',
        'Change Speaker Language.',
        'Press ⚡ to start.',
      ],
    },
  },
  ko: {
    start: {
      title: 'AI 통역 시작하기',
      steps: [
        'CaptionKit을 엽니다.',
        '오른쪽의 Caption Controls를 찾습니다. (안 보이면 Broadcast 클릭)',
        'Speaker Language를 선택합니다.',
        '⚡ 버튼을 눌러 시작합니다.',
      ],
    },
    change: {
      title: 'Speaker Language 변경하기',
      steps: [
        'CaptionKit을 엽니다.',
        '오른쪽의 Caption Controls를 찾습니다. (안 보이면 Broadcast 클릭)',
        '통역을 중지합니다.',
        'Speaker Language를 변경합니다.',
        '⚡ 버튼을 눌러 시작합니다.',
      ],
    },
  },
  zh: {
    start: {
      title: '开始 AI 翻译',
      steps: [
        '打开 CaptionKit。',
        '在右侧找到 Caption Controls。（未显示时点击 Broadcast）',
        '选择 Speaker Language。',
        '点击 ⚡ 开始。',
      ],
    },
    change: {
      title: '更改 Speaker Language',
      steps: [
        '打开 CaptionKit。',
        '在右侧找到 Caption Controls。（未显示时点击 Broadcast）',
        '停止翻译。',
        '更改 Speaker Language。',
        '点击 ⚡ 开始。',
      ],
    },
  },
};
let appState = null;
let activeGuideLanguage = 'en';
let activeGuideMode = 'start';
let toastTimer = null;
let statusPollingDisabled = false;
let microphoneStream = null;
let microphoneAudioContext = null;
let microphoneAnimationFrame = null;
let microphoneTestTimer = null;
let microphonePeak = 0;

function getControlPin() {
  return localStorage.getItem(PIN_STORAGE_KEY) || '';
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const pin = getControlPin();
  if (pin) headers['X-Control-Pin'] = pin;
  if (options.body) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { ...options, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, error: `Invalid server response (${response.status})` };
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', type === 'error');
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3600);
}

function displayPath(type) {
  return `/display/${type === 'full' ? 'full' : 'subtitle'}`;
}

function updateDisplayAddresses() {
  document.querySelectorAll('[data-display-address]').forEach((element) => {
    element.textContent = `${window.location.origin}${displayPath(element.dataset.displayAddress)}`;
  });
}

function displayElement(type, suffix) {
  return document.querySelector(`#${type}${suffix}`);
}

function renderGuide() {
  const copy = GUIDE_COPY[activeGuideLanguage][activeGuideMode];
  elements.quickStartTitle.textContent = copy.title;
  elements.quickStartSteps.style.setProperty('--guide-columns', copy.steps.length);
  elements.quickStartStepItems.forEach((item, index) => {
    const visible = index < copy.steps.length;
    item.hidden = !visible;
    if (visible) elements.quickStartStepLabels[index].textContent = copy.steps[index];
  });
  elements.guideLanguageButtons.forEach((button) => {
    const selected = button.dataset.guideLanguage === activeGuideLanguage;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  elements.guideModeButtons.forEach((button) => {
    const selected = button.dataset.guideMode === activeGuideMode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function selectGuideLanguage(language) {
  activeGuideLanguage = GUIDE_COPY[language] ? language : 'en';
  localStorage.setItem(GUIDE_LANGUAGE_STORAGE_KEY, activeGuideLanguage);
  renderGuide();
}

function selectGuideMode(mode) {
  activeGuideMode = mode === 'change' ? 'change' : 'start';
  localStorage.setItem(GUIDE_MODE_STORAGE_KEY, activeGuideMode);
  renderGuide();
}

function renderDisplayControls(settings) {
  for (const type of DISPLAY_TYPES) {
    const display = settings.displays[type];
    displayElement(type, 'LinesValue').textContent = display.lines;
    displayElement(type, 'FontSizeValue').textContent = display.fontSize;
    displayElement(type, 'LineSpacingValue').textContent = `${display.lineSpacing}%`;
    displayElement(type, 'WidthValue').textContent = `${display.width}%`;
  }
}

function render(nextState) {
  if (!nextState) return;
  appState = nextState;
  const { settings, runtime } = nextState;

  renderDisplayControls(settings);
  updateDisplayAddresses();
  elements.captionkitDashboardLinks.forEach((link) => {
    link.href = `https://app.captionkit.com/${encodeURIComponent(settings.handle)}`;
  });
  elements.setupNotice.classList.toggle('is-hidden', nextState.apiKeyConfigured);

  elements.livePill.classList.remove('is-live', 'is-stopped', 'is-unknown', 'is-error');
  if (runtime.lastError) {
    elements.livePill.classList.add('is-error');
    elements.liveLabel.textContent = 'ERROR';
  } else if (runtime.live === true) {
    elements.livePill.classList.add('is-live');
    elements.liveLabel.textContent = 'LIVE';
  } else if (runtime.live === false) {
    elements.livePill.classList.add('is-stopped');
    elements.liveLabel.textContent = 'STOPPED';
  } else if (runtime.lastAction === 'start') {
    elements.livePill.classList.add('is-unknown');
    elements.liveLabel.textContent = 'STARTING';
  } else {
    elements.livePill.classList.add('is-unknown');
    elements.liveLabel.textContent = nextState.apiKeyConfigured ? 'READY' : 'SETUP';
  }

  if (!elements.settingsDialog.open) fillSettingsForm();
}

function fillSettingsForm() {
  if (!appState) return;
  const { settings, apiKeyConfigured, apiKeyFromEnvironment } = appState;
  elements.handleInput.value = settings.handle;
  elements.koreanCodeInput.value = settings.koreanCode;
  elements.englishCodeInput.value = settings.englishCode;
  for (const type of DISPLAY_TYPES) {
    const display = settings.displays[type];
    displayElement(type, 'WidthInput').value = display.width;
    displayElement(type, 'FontSizeInput').value = display.fontSize;
    displayElement(type, 'LineSpacingInput').value = display.lineSpacing;
    displayElement(type, 'LinesInput').value = display.lines;
    displayElement(type, 'PositionInput').value = display.position;
    displayElement(type, 'BackgroundColorInput').value = display.backgroundColor;
    displayElement(type, 'RoundedInput').checked = display.rounded;
  }
  elements.controlPinInput.value = getControlPin();
  elements.apiKeyInput.value = '';
  elements.apiKeyInput.disabled = apiKeyFromEnvironment;

  if (apiKeyFromEnvironment) {
    elements.apiKeyHelp.textContent = 'Using the API key from .env.';
    elements.apiKeyHelp.classList.add('is-connected');
  } else if (apiKeyConfigured) {
    elements.apiKeyHelp.textContent = 'API key saved on this computer.';
    elements.apiKeyHelp.classList.add('is-connected');
  } else {
    elements.apiKeyHelp.textContent = 'Create one in CaptionKit Account settings.';
    elements.apiKeyHelp.classList.remove('is-connected');
  }
}

async function saveConfig(patch, successMessage = 'Display settings saved.') {
  try {
    const payload = await apiRequest('/api/config', {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    render(payload.state);
    showToast(successMessage);
    return true;
  } catch (error) {
    showToast(error.message, 'error');
    if (error.status === 401 && appState?.controlPinRequired) openSettings();
    return false;
  }
}

async function refreshStatus() {
  if (!appState?.apiKeyConfigured || statusPollingDisabled) return;
  try {
    const payload = await apiRequest('/api/status');
    render(payload.state);
  } catch (error) {
    if (error.status === 401) {
      statusPollingDisabled = true;
      const isPinError = /PIN/i.test(error.message);
      showToast(isPinError
        ? 'Enter the correct Control PIN in Settings.'
        : 'Check your CaptionKit API key.', 'error');
    }
  }
}

function setMicrophoneState(state, message) {
  elements.microphoneDot.className = `microphone-dot is-${state}`;
  elements.microphoneStatus.textContent = message;
}

async function refreshMicrophoneDevices(preferredDeviceId = '') {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const selected = preferredDeviceId
    || elements.microphoneDeviceSelect.value
    || localStorage.getItem(MIC_DEVICE_STORAGE_KEY)
    || '';

  elements.microphoneDeviceSelect.replaceChildren(new Option('Default microphone', ''));
  inputs.forEach((device, index) => {
    const label = device.label || `Microphone ${index + 1}`;
    elements.microphoneDeviceSelect.add(new Option(label, device.deviceId));
  });

  if ([...elements.microphoneDeviceSelect.options].some((option) => option.value === selected)) {
    elements.microphoneDeviceSelect.value = selected;
  }
}

async function stopMicrophoneTest(finalMessage = '') {
  clearTimeout(microphoneTestTimer);
  cancelAnimationFrame(microphoneAnimationFrame);
  microphoneTestTimer = null;
  microphoneAnimationFrame = null;

  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }
  if (microphoneAudioContext) {
    await microphoneAudioContext.close().catch(() => {});
    microphoneAudioContext = null;
  }

  elements.microphoneTestButton.disabled = false;
  elements.microphoneTestButton.textContent = 'Test microphone';
  elements.microphoneDeviceSelect.disabled = false;
  elements.microphoneLevelBar.style.width = '0%';
  elements.microphoneLevel.setAttribute('aria-valuenow', '0');
  if (finalMessage) setMicrophoneState('idle', finalMessage);
}

function microphoneErrorMessage(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return 'Microphone access is blocked. Allow it in the browser site settings.';
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return 'No microphone found. Check the device connection and Windows input settings.';
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return 'The microphone is busy. Close other audio apps and try again.';
  }
  if (error.name === 'OverconstrainedError') {
    return 'The selected microphone is unavailable. Try the default microphone.';
  }
  return `Microphone test failed: ${error.message || error.name}`;
}

async function startMicrophoneTest() {
  if (microphoneStream) {
    await stopMicrophoneTest('Microphone test stopped.');
    return;
  }
  if (!window.isSecureContext) {
    setMicrophoneState('error', 'Open this page at 127.0.0.1 on this computer to test the microphone.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setMicrophoneState('error', 'Microphone access is not supported in this browser. Use the latest Chrome.');
    return;
  }

  elements.microphoneTestButton.disabled = true;
  elements.microphoneDeviceSelect.disabled = true;
  setMicrophoneState('checking', 'Allow microphone access in the browser…');

  try {
    const deviceId = elements.microphoneDeviceSelect.value;
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    });

    const track = microphoneStream.getAudioTracks()[0];
    const activeDeviceId = track.getSettings().deviceId || deviceId;
    if (activeDeviceId) localStorage.setItem(MIC_DEVICE_STORAGE_KEY, activeDeviceId);
    await refreshMicrophoneDevices(activeDeviceId);

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      setMicrophoneState('ready', `Microphone ready: ${track.label || 'Default microphone'}`);
      await stopMicrophoneTest();
      return;
    }

    microphoneAudioContext = new AudioContext();
    await microphoneAudioContext.resume();
    const source = microphoneAudioContext.createMediaStreamSource(microphoneStream);
    const analyser = microphoneAudioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    microphonePeak = 0;

    elements.microphoneTestButton.disabled = false;
    elements.microphoneTestButton.textContent = 'Stop test';
    setMicrophoneState('testing', `Speak now: ${track.label || 'Default microphone'}`);

    const updateLevel = () => {
      analyser.getByteTimeDomainData(samples);
      let squareSum = 0;
      samples.forEach((sample) => {
        const normalized = (sample - 128) / 128;
        squareSum += normalized * normalized;
      });
      const rms = Math.sqrt(squareSum / samples.length);
      microphonePeak = Math.max(microphonePeak, rms);
      const percent = Math.min(100, Math.round(rms * 500));
      elements.microphoneLevelBar.style.width = `${percent}%`;
      elements.microphoneLevel.setAttribute('aria-valuenow', String(percent));
      microphoneAnimationFrame = requestAnimationFrame(updateLevel);
    };
    updateLevel();

    microphoneTestTimer = setTimeout(async () => {
      const heardAudio = microphonePeak >= 0.015;
      const message = heardAudio
        ? `Input detected. Select the same device in CaptionKit: ${track.label || 'Default microphone'}`
        : `No input detected: ${track.label || 'Default microphone'}`;
      await stopMicrophoneTest();
      setMicrophoneState(heardAudio ? 'ready' : 'warning', message);
    }, 7000);
  } catch (error) {
    await stopMicrophoneTest();
    setMicrophoneState('error', microphoneErrorMessage(error));
  }
}

function openSettings() {
  fillSettingsForm();
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

async function copyDisplayAddress(type = 'subtitle') {
  const address = `${window.location.origin}${displayPath(type)}`;
  try {
    await navigator.clipboard.writeText(address);
    showToast('Display URL copied.');
  } catch {
    window.prompt('Copy this URL:', address);
  }
}

document.querySelectorAll('[data-copy-display]').forEach((button) => {
  button.addEventListener('click', () => copyDisplayAddress(button.dataset.copyDisplay));
});

document.querySelectorAll('[data-open-display]').forEach((button) => {
  button.addEventListener('click', () => {
    window.open(`${displayPath(button.dataset.openDisplay)}?debug=1`, '_blank', 'noopener');
  });
});

document.querySelectorAll('[data-adjust]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!appState) return;
    const type = button.dataset.displayType;
    const key = button.dataset.adjust;
    const delta = Number(button.dataset.delta);
    const limits = key === 'width'
      ? [20, 100]
      : key === 'lineSpacing' ? [0, 100]
        : key === 'lines' ? [1, 10] : [2, 30];
    const value = Math.max(limits[0], Math.min(
      limits[1],
      Number(appState.settings.displays[type][key]) + delta,
    ));
    saveConfig({ displays: { [type]: { [key]: value } } });
  });
});

elements.guideLanguageButtons.forEach((button) => {
  button.addEventListener('click', () => selectGuideLanguage(button.dataset.guideLanguage));
});

elements.guideModeButtons.forEach((button) => {
  button.addEventListener('click', () => selectGuideMode(button.dataset.guideMode));
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    elements.settingsDialog.close();
    return;
  }

  localStorage.setItem(PIN_STORAGE_KEY, elements.controlPinInput.value.trim());
  statusPollingDisabled = false;
  const patch = {
    handle: elements.handleInput.value,
    koreanCode: elements.koreanCodeInput.value,
    englishCode: elements.englishCodeInput.value,
    displays: Object.fromEntries(DISPLAY_TYPES.map((type) => [type, {
      width: Number(displayElement(type, 'WidthInput').value),
      fontSize: Number(displayElement(type, 'FontSizeInput').value),
      lineSpacing: Number(displayElement(type, 'LineSpacingInput').value),
      lines: Number(displayElement(type, 'LinesInput').value),
      position: displayElement(type, 'PositionInput').value,
      backgroundColor: displayElement(type, 'BackgroundColorInput').value,
      rounded: displayElement(type, 'RoundedInput').checked,
    }])),
  };
  if (elements.apiKeyInput.value.trim()) patch.apiKey = elements.apiKeyInput.value.trim();

  const saved = await saveConfig(patch, 'Settings saved.');
  if (saved) {
    elements.settingsDialog.close();
    setTimeout(refreshStatus, 300);
  }
});

document.querySelector('#openSettingsButton').addEventListener('click', openSettings);
document.querySelector('#noticeSettingsButton').addEventListener('click', openSettings);
elements.microphoneTestButton.addEventListener('click', startMicrophoneTest);
elements.microphoneDeviceSelect.addEventListener('change', () => {
  const deviceId = elements.microphoneDeviceSelect.value;
  if (deviceId) localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId);
  else localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
});
elements.settingsDialog.addEventListener('close', () => {
  if (microphoneStream) stopMicrophoneTest('Microphone test stopped.');
});
window.addEventListener('pagehide', () => stopMicrophoneTest());

async function initialize() {
  selectGuideLanguage(localStorage.getItem(GUIDE_LANGUAGE_STORAGE_KEY) || 'en');
  selectGuideMode(localStorage.getItem(GUIDE_MODE_STORAGE_KEY) || 'start');
  updateDisplayAddresses();
  refreshMicrophoneDevices().catch(() => {});
  navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshMicrophoneDevices().catch(() => {}));
  try {
    const payload = await apiRequest('/api/state');
    render(payload.state);
    refreshStatus();
  } catch (error) {
    showToast(`Local server error: ${error.message}`, 'error');
  }

  const events = new EventSource('/api/events');
  events.onmessage = (event) => {
    try {
      render(JSON.parse(event.data));
    } catch {
      // Ignore malformed state updates and keep the current screen usable.
    }
  };
  events.onerror = () => {
    elements.livePill.classList.remove('is-live', 'is-stopped', 'is-error');
    elements.livePill.classList.add('is-unknown');
    elements.liveLabel.textContent = 'RECONNECTING';
  };

  setInterval(refreshStatus, 3000);
}

initialize();
