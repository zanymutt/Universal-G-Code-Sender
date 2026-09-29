(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const fieldIds = ['direction', 'units', 'distance', 'cutSpeed', 'safeHeight', 'pierceHeight', 'cutHeight', 'pierceDelay', 'thc', 'probeCode'];
  let requestId = 0;
  let pending = new Map();
  let settings = {};
  let code = '';
  let savePending = false;
  let settingsTimer = null;

  function message(text, error) {
    $('message').textContent = text;
    $('message').classList.toggle('error', Boolean(error));
  }

  function host(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (window.parent === window) {
        reject(new Error('Open this plugin from UGS Dashboard.'));
        return;
      }
      const id = ++requestId;
      const timer = timeoutMs > 0 ? setTimeout(() => {
        pending.delete(id);
        reject(new Error(`No reply to ${method}; check Dashboard.`));
      }, timeoutMs) : null;
      pending.set(id, { resolve, reject, timer });
      try {
        window.parent.postMessage({ type: 'fluid-request', id, method, params }, '*');
      } catch (error) {
        if (timer) clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (data?.type === 'fluid-response') {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (request.timer) clearTimeout(request.timer);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
    } else if (data?.type === 'fluid-event' && data.event === 'theme') {
      applyTheme(data.data);
    } else if (data?.type === 'fluid-event' && data.event === 'status') {
      updateMachineState(data.data);
    }
  });

  function applyTheme(theme) {
    if (!theme || !theme.colors) return;
    const root = document.documentElement.style;
    root.setProperty('--plugin-bg', theme.colors.background);
    root.setProperty('--plugin-surface', theme.colors.surface);
    root.setProperty('--plugin-surface-raised', theme.colors.surfaceRaised);
    root.setProperty('--plugin-border', theme.colors.border);
    root.setProperty('--plugin-border-strong', theme.colors.borderStrong);
    root.setProperty('--plugin-text', theme.colors.text);
    root.setProperty('--plugin-text-muted', theme.colors.textMuted);
    root.setProperty('--plugin-accent', theme.colors.accent);
    root.setProperty('--plugin-accent-contrast', theme.mode === 'light' ? '#ffffff' : '#111213');
  }

  function updateMachineState(status) {
    if (!status || !status.state) return;
    $('machineState').textContent = `Machine: ${status.state}`;
  }

  function readForm() {
    const values = {};
    fieldIds.forEach(id => {
      const element = $(id);
      values[id] = element.type === 'checkbox' ? element.checked : element.value;
    });
    return values;
  }

  function applyForm(values) {
    fieldIds.forEach(id => {
      if (!Object.prototype.hasOwnProperty.call(values, id)) return;
      const element = $(id);
      if (element.type === 'checkbox') element.checked = Boolean(values[id]);
      else element.value = values[id];
    });
  }

  function scheduleSettingsSave() {
    if (window.parent === window) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      settings = { ...settings, straightCutLast: readForm() };
      host('saveSettings', { data: settings }).catch(() => {});
    }, 500);
  }

  function invalidateGeneratedCode() {
    code = '';
    $('output').value = '';
    $('lineCount').textContent = '0 lines';
    $('save').disabled = true;
    $('copy').disabled = true;
  }

  $('generate').addEventListener('click', () => {
    try {
      code = window.StraightCut.generate(readForm());
      $('output').value = code;
      $('lineCount').textContent = `${code.trimEnd().split('\n').length} lines`;
      $('save').disabled = window.parent === window;
      $('copy').disabled = false;
      message('Generated. Review the code, then save it into Dashboard.');
    } catch (error) {
      invalidateGeneratedCode();
      message(error.message || String(error), true);
    }
  });

  fieldIds.forEach(id => {
    $(id).addEventListener('input', () => {
      invalidateGeneratedCode();
      scheduleSettingsSave();
    });
    $(id).addEventListener('change', () => {
      invalidateGeneratedCode();
      scheduleSettingsSave();
    });
  });

  $('save').addEventListener('click', async () => {
    if (!code || savePending) return;
    savePending = true;
    $('save').disabled = true;
    try {
      await host('saveGcodeAs', { content: code }, 0);
      message('Saved and opened in Dashboard. Start the job from the main Dashboard controls.');
    } catch (error) {
      message(error.message || String(error), true);
    } finally {
      savePending = false;
      $('save').disabled = !code || window.parent === window;
    }
  });

  $('copy').addEventListener('click', async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      message('G-code copied.');
    } catch {
      $('output').focus();
      $('output').select();
      message('G-code selected. Use your device’s Copy command.');
    }
  });

  async function connectBridge() {
    if (window.parent === window) {
      $('machineState').textContent = 'Offline preview';
      $('save').disabled = true;
      return;
    }

    try {
      const theme = await host('getTheme');
      applyTheme(theme);
      await host('subscribe', { event: 'theme' });
    } catch { /* Older Dashboard builds keep the fallback palette. */ }

    try {
      const status = await host('getStatus');
      updateMachineState(status);
      await host('subscribe', { event: 'status' });
    } catch (error) {
      $('machineState').textContent = error.message || 'Dashboard connection unavailable';
    }

    try {
      const stored = await host('getSettings');
      settings = stored && typeof stored === 'object' ? stored : {};
      if (settings.straightCutLast && typeof settings.straightCutLast === 'object') {
        applyForm(settings.straightCutLast);
      }
    } catch (error) {
      message('Could not load saved settings: ' + (error.message || error), true);
    }
  }

  connectBridge();
})();
