'use strict';

const elements = {
  livePill: document.querySelector('#livePill'),
  liveLabel: document.querySelector('#liveLabel'),
  setupNotice: document.querySelector('#setupNotice'),
  lastUpdatedLabel: document.querySelector('#lastUpdatedLabel'),
  fontSizeValue: document.querySelector('#fontSizeValue'),
  widthValue: document.querySelector('#widthValue'),
  displayAddress: document.querySelector('#displayAddress'),
  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  stopDialog: document.querySelector('#stopDialog'),
  toast: document.querySelector('#toast'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyHelp: document.querySelector('#apiKeyHelp'),
  handleInput: document.querySelector('#handleInput'),
  controlPinInput: document.querySelector('#controlPinInput'),
  koreanCodeInput: document.querySelector('#koreanCodeInput'),
  englishCodeInput: document.querySelector('#englishCodeInput'),
  widthInput: document.querySelector('#widthInput'),
  fontSizeInput: document.querySelector('#fontSizeInput'),
  linesInput: document.querySelector('#linesInput'),
  positionInput: document.querySelector('#positionInput'),
  backgroundColorInput: document.querySelector('#backgroundColorInput'),
  roundedInput: document.querySelector('#roundedInput'),
  microphoneDot: document.querySelector('#microphoneDot'),
  microphoneStatus: document.querySelector('#microphoneStatus'),
  microphoneLevel: document.querySelector('#microphoneLevel'),
  microphoneLevelBar: document.querySelector('#microphoneLevelBar'),
  microphoneDeviceSelect: document.querySelector('#microphoneDeviceSelect'),
  microphoneTestButton: document.querySelector('#microphoneTestButton'),
};

const PIN_STORAGE_KEY = 'mycaptionkit-control-pin';
const MIC_DEVICE_STORAGE_KEY = 'mycaptionkit-microphone-device';
let appState = null;
let busy = false;
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

function actionLabel(action) {
  return {
    start: 'Streaming started.',
    stop: 'Streaming stopped.',
  }[action] || 'Done.';
}

function render(nextState) {
  if (!nextState) return;
  appState = nextState;
  const { settings, runtime } = nextState;

  elements.fontSizeValue.textContent = settings.fontSize;
  elements.widthValue.textContent = `${settings.width}%`;
  elements.displayAddress.textContent = `${window.location.origin}/display`;
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

  document.querySelectorAll('[data-start-mode]').forEach((button) => {
    const active = runtime.live === true && button.dataset.startMode === settings.activeMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-set]').forEach((button) => {
    const expected = String(settings[button.dataset.set]);
    button.classList.toggle('is-active', button.dataset.value === expected);
    button.setAttribute('aria-pressed', String(button.dataset.value === expected));
  });

  elements.lastUpdatedLabel.textContent = runtime.live === true
    ? 'LIVE'
    : runtime.live === null && runtime.lastAction === 'start' ? 'Starting' : 'Ready';

  if (!elements.settingsDialog.open) fillSettingsForm();
}

function fillSettingsForm() {
  if (!appState) return;
  const { settings, apiKeyConfigured, apiKeyFromEnvironment } = appState;
  elements.handleInput.value = settings.handle;
  elements.koreanCodeInput.value = settings.koreanCode;
  elements.englishCodeInput.value = settings.englishCode;
  elements.widthInput.value = settings.width;
  elements.fontSizeInput.value = settings.fontSize;
  elements.linesInput.value = settings.lines;
  elements.positionInput.value = settings.position;
  elements.backgroundColorInput.value = settings.backgroundColor;
  elements.roundedInput.checked = settings.rounded;
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

function setBusy(value) {
  busy = value;
  document.querySelectorAll('[data-action], [data-start-mode]').forEach((button) => {
    button.disabled = value;
  });
}

async function performAction(action, extra = {}) {
  if (busy) return;
  setBusy(true);
  try {
    const payload = await apiRequest('/api/action', {
      method: 'POST',
      body: JSON.stringify({ action, ...extra }),
    });
    render(payload.state);
    showToast(actionLabel(action));
    if (action === 'start') setTimeout(verifyCaptionKitStarted, 2500);
    if (action === 'stop') setTimeout(refreshStatus, 1500);
  } catch (error) {
    showToast(error.message, 'error');
    if (error.status === 401 && appState?.controlPinRequired) {
      openSettings();
      elements.controlPinInput.focus();
    }
  } finally {
    setBusy(false);
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

async function verifyCaptionKitStarted() {
  if (!appState?.apiKeyConfigured || statusPollingDisabled) return;
  try {
    const payload = await apiRequest('/api/status');
    render(payload.state);
    if (!payload.status?.live) {
      showToast('CaptionKit did not start. Check microphone access and 📡 Signals in the dashboard.', 'error');
      return;
    }

    const stream = payload.status.status;
    const expectedInput = payload.state.mode.sourceLanguage;
    const actualInput = stream?.options?.language;
    if (actualInput && actualInput.toLowerCase() !== expectedInput.toLowerCase()) {
      showToast(`CaptionKit input is ${actualInput}, but ${expectedInput} was requested. Try the language button again.`, 'error');
      return;
    }

    const output = payload.state.mode.displayLanguage.toLowerCase();
    const outputBase = output.split('-')[0];
    const translations = stream?.options?.translations || [];
    const translationEnabled = translations.some((language) => {
      const normalized = String(language).toLowerCase();
      return normalized === output || normalized.split('-')[0] === outputBase;
    });
    if (!translationEnabled && outputBase !== actualInput?.toLowerCase().split('-')[0]) {
      showToast(`Enable ${payload.state.mode.displayLabel} under CaptionKit Translations.`, 'error');
    }
  } catch (error) {
    showToast(`Could not verify CaptionKit: ${error.message}`, 'error');
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

async function copyDisplayAddress() {
  const address = `${window.location.origin}/display`;
  try {
    await navigator.clipboard.writeText(address);
    showToast('Display URL copied.');
  } catch {
    window.prompt('Copy this URL:', address);
  }
}

document.querySelectorAll('[data-start-mode]').forEach((button) => {
  button.addEventListener('click', () => performAction('start', { mode: button.dataset.startMode }));
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.action === 'stop') {
      elements.stopDialog.showModal();
      return;
    }
    performAction(button.dataset.action);
  });
});

document.querySelector('#confirmStopButton').addEventListener('click', (event) => {
  event.preventDefault();
  elements.stopDialog.close();
  performAction('stop');
});

document.querySelectorAll('[data-set]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.set;
    const rawValue = button.dataset.value;
    const value = key === 'lines' ? Number(rawValue) : rawValue;
    saveConfig({ [key]: value });
  });
});

document.querySelectorAll('[data-adjust]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!appState) return;
    const key = button.dataset.adjust;
    const delta = Number(button.dataset.delta);
    const limits = key === 'width' ? [20, 100] : [2, 30];
    const value = Math.max(limits[0], Math.min(limits[1], Number(appState.settings[key]) + delta));
    saveConfig({ [key]: value });
  });
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
    width: Number(elements.widthInput.value),
    fontSize: Number(elements.fontSizeInput.value),
    lines: Number(elements.linesInput.value),
    position: elements.positionInput.value,
    backgroundColor: elements.backgroundColorInput.value,
    rounded: elements.roundedInput.checked,
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
document.querySelector('#copyDisplayButton').addEventListener('click', copyDisplayAddress);
document.querySelector('#copyDisplayTextButton').addEventListener('click', copyDisplayAddress);
document.querySelector('#openDisplayButton').addEventListener('click', () => window.open('/display?debug=1', '_blank', 'noopener'));
elements.microphoneTestButton.addEventListener('click', startMicrophoneTest);
elements.microphoneDeviceSelect.addEventListener('change', () => {
  const deviceId = elements.microphoneDeviceSelect.value;
  if (deviceId) localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId);
  else localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
});
window.addEventListener('pagehide', () => stopMicrophoneTest());

async function initialize() {
  elements.displayAddress.textContent = `${window.location.origin}/display`;
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
    elements.lastUpdatedLabel.textContent = 'Reconnecting';
  };

  setInterval(refreshStatus, 7000);
}

initialize();
