let ws = null;
let lastSeq = null;
let gapCount = 0;
let frameCount = 0;
let latest = null;
let lastRenderTime = 0;

const $ = (id) => document.getElementById(id);

// ---- Dashboard bridge -----------------------------------------------------
// Theme: the host supplies the mode, the structural colors and the accent.
// The panel's own semantic tokens (--plugin-good/-warn/-danger) stay in
// style.css per mode, so "current is red, setpoint is green" holds whichever
// accent the dashboard is using.
function applyTheme(snapshot) {
  if (!snapshot || !snapshot.colors) return;
  const root = document.documentElement;
  const c = snapshot.colors;
  const mode = snapshot.mode === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', mode);
  root.style.colorScheme = mode;
  root.style.setProperty('--plugin-bg', c.background);
  root.style.setProperty('--plugin-surface', c.surface);
  root.style.setProperty('--plugin-surface-raised', c.surfaceRaised);
  root.style.setProperty('--plugin-border', c.border);
  root.style.setProperty('--plugin-border-strong', c.borderStrong);
  root.style.setProperty('--plugin-text', c.text);
  root.style.setProperty('--plugin-text-muted', c.textMuted);
  root.style.setProperty('--plugin-accent', c.accent);
}

// Saved settings are one JSON blob per plugin (last save wins), so keep the
// whole object and only change the keys this panel owns.
let pluginSettings = {};
function savePluginSettings() {
  if (!window.Fluid) return;
  Fluid.saveSettings(pluginSettings).catch((e) => console.warn('Could not save THC plugin settings', e));
}

function initDashboardBridge() {
  if (!window.Fluid) return;
  Fluid.getTheme().then(applyTheme).catch(() => {});
  Fluid.on('theme', applyTheme);
  Fluid.getSettings().then((s) => {
    pluginSettings = (s && typeof s === 'object') ? s : {};
    // Don't overwrite an address the person has already started typing.
    if (typeof pluginSettings.thcHost === 'string' && !$('host').value) $('host').value = pluginSettings.thcHost;
  }).catch(() => {});
}

// ---- In-page notice / confirm / export (alert, confirm, prompt and file
// downloads are all blocked inside the sandboxed plugin iframe) -------------
let noticeTimer = null;
function notify(text, warn) {
  const n = $('notice');
  n.textContent = text;
  n.classList.toggle('warn', !!warn);
  n.hidden = !text;
  clearTimeout(noticeTimer);
  if (text) noticeTimer = setTimeout(() => { n.hidden = true; }, warn ? 8000 : 5000);
}

let pendingConfirm = null;
function askConfirm(message, acceptLabel, action) {
  notify('');
  pendingConfirm = action;
  $('confirmMessage').textContent = message;
  $('confirmAcceptBtn').textContent = acceptLabel || 'Continue';
  $('confirmBar').hidden = false;
}
function closeConfirm() { pendingConfirm = null; $('confirmBar').hidden = true; }
$('confirmCancelBtn').onclick = closeConfirm;
$('confirmAcceptBtn').onclick = () => {
  const action = pendingConfirm;
  closeConfirm();
  if (action) action();
};

function showExportDialog(title, filename, text) {
  $('exportTitle').textContent = title;
  $('exportName').textContent = filename;
  $('exportText').value = text;
  $('exportPanel').hidden = false;
}
$('closeExportBtn').onclick = () => { $('exportPanel').hidden = true; };
$('copyExportBtn').onclick = async () => {
  const box = $('exportText');
  try {
    await navigator.clipboard.writeText(box.value);
    notify('Copied to the clipboard.');
  } catch (e) {
    box.focus();
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    notify(ok ? 'Copied to the clipboard.' : 'Could not copy - select the text and copy it manually.', !ok);
  }
};

// Preferred route: ask the dashboard (which is not sandboxed) to save the file.
// A dashboard without a downloadFile method rejects, and the text is shown for
// copying instead - so this works against both.
function exportText(filename, title, text) {
  const fallback = () => showExportDialog(title, filename, text);
  if (window.Fluid && typeof Fluid.downloadFile === 'function') {
    Fluid.downloadFile(filename, text)
      .then((r) => notify('Saved ' + ((r && r.filename) || filename) + '.'))
      .catch((e) => {
        // Closing the Save As dialog is an answer, not a failure.
        if (e && /cancel/i.test(String(e.message))) notify('Save cancelled.');
        else fallback();
      });
  } else {
    fallback();
  }
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Tabs -----------------------------------------------------------------
document.querySelectorAll('.tabs button[data-tab]').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    document.querySelectorAll('.tabPanel').forEach((p) => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
    if (typeof renderMovementCurve === 'function') { renderMovementCurve(); renderVoltGraph(); }
  };
});

let linkState = 'disconnected';   // 'disconnected' | 'connecting' | 'connected'
let lastFrameAt = 0;              // performance.now() of the last telemetry frame

function setStatus(text, ok) {
  const el = $('status');
  el.textContent = text;
  el.className = 'pill ' + (ok ? 'on' : 'bad');
  const connecting = text.indexOf('connecting') === 0;
  linkState = ok ? 'connected' : connecting ? 'connecting' : 'disconnected';
  $('linkDot').className = 'dot' + (ok ? ' on' : connecting ? ' wait' : '');
  $('dState').textContent = ok ? 'connected' : text;
  updateOfflineBar();
}

// One slim banner on Operate/Settings instead of a permanent connection
// row up top - the thing that actually matters away from the Link page is
// "these numbers are not live", so that's the only thing it says.
function updateOfflineBar() {
  const bar = $('offlineBar');
  let msg = '';
  if (linkState === 'connecting') msg = 'Connecting to THC... (tap for Link)';
  else if (linkState !== 'connected') msg = 'Not connected - readings below are NOT live. Tap here to open Link.';
  else if (!latest) msg = 'Connected - waiting for the first telemetry frame...';
  else if (performance.now() - lastFrameAt > 3000) msg = 'Connected, but no telemetry for ' + Math.round((performance.now() - lastFrameAt) / 1000) + ' s - readings are stale. (tap for Link)';
  bar.textContent = msg;
  bar.hidden = !msg;
  refreshLinkIndicators();
}

// An open WebSocket is not a live THC: a powered-off controller never sends a
// FIN, so the socket can sit "open" for minutes. The dot and the Link pill
// therefore only go green while telemetry is actually arriving; amber means
// connected but silent (or still waiting for the first frame).
function refreshLinkIndicators() {
  const live = linkState === 'connected' && !!latest && (performance.now() - lastFrameAt) <= 3000;
  const dot = $('linkDot');
  dot.className = 'dot' + (live ? ' on' : (linkState === 'connected' || linkState === 'connecting') ? ' wait' : '');
  if (linkState !== 'connected') return;
  const pill = $('status');
  pill.textContent = live ? 'connected' : (latest ? 'no data' : 'waiting for data');
  pill.className = 'pill ' + (live ? 'on' : 'warn');
  $('dState').textContent = live ? 'connected' : (latest ? 'connected - NO DATA' : 'connected - waiting for data');
}

// ---- Field tables -----------------------------------------------------
// group: which top-level JSON object the field lives in ("thc","movement","voltage","sync")
// key: the field's JSON key within that group
// label: human label
// kind: "volts"/"seconds"/"tenthPct"/"tenthMm"/"raw"/"mode"/"bool"/"ratio"/"alpha"/"mmPerMin"
// unit: display suffix
const FIELDS = {
  thc: [
    { key: 'setpointVoltage', label: 'Setpoint voltage', kind: 'volts', unit: 'V' },
    { key: 'tolerance', label: 'Tolerance', kind: 'volts', unit: 'V' },
    { key: 'antidivePct', label: 'Anti-dive %', kind: 'tenthPct', unit: '%' },
    { key: 'voidSenseV', label: 'Void-sense voltage', kind: 'volts', unit: 'V' },
    { key: 'arcStabilizeDelay', label: 'Arc stabilize delay', kind: 'seconds', unit: 's' },
    { key: 'pierceDelay', label: 'Pierce delay', kind: 'seconds', unit: 's' },
    { key: 'testCutTime', label: 'Averaging time', kind: 'seconds', unit: 's' },
    { key: 'firstAvgDist', label: 'First-avg distance', kind: 'raw', unit: '' },
    { key: 'updownAmt', label: 'Jog up/down amount', kind: 'tenthMm', unit: 'mm' },
    { key: 'delayStartEvent', label: 'Delay-start bitmask', kind: 'raw', unit: '', hint: '0=arc_ok, 2=torch, 4=move' },
    { key: 'mode', label: 'THC mode', kind: 'mode', unit: '' },
    { key: 'stepsPerMm', label: 'Steps per mm', kind: 'raw', unit: '' },
    { key: 'testRun', label: 'Test run', kind: 'bool', unit: '' },
  ],
  movement: [
    { key: 'exp', label: 'Curve exponent', kind: 'floatRaw', unit: '' },
    { key: 'minVoltage', label: 'Min voltage', kind: 'volts', unit: 'V' },
    { key: 'maxVoltage', label: 'Max voltage', kind: 'volts', unit: 'V' },
    { key: 'minSpeed', label: 'Min speed', kind: 'mmPerMin', unit: 'mm/min' },
    { key: 'maxSpeed', label: 'Max speed', kind: 'mmPerMin', unit: 'mm/min' },
    { key: 'ultimateMax', label: 'Ultimate max speed', kind: 'mmPerMin', unit: 'mm/min' },
    { key: 'tieMinToTolerance', label: 'Tie min voltage to tolerance', kind: 'bool', unit: '' },
  ],
  voltage: [
    { key: 'multifactor', label: 'Divider multifactor', kind: 'ratio', unit: ':1' },
    { key: 'calibrationOffset', label: 'Calibration offset', kind: 'volts', unit: 'V' },
    { key: 'numAvgReading', label: 'Num averaged readings', kind: 'raw', unit: '' },
    { key: 'numRealtimeSamples', label: 'Num realtime median samples', kind: 'raw', unit: '' },
    { key: 'expAlpha', label: 'Exponential filter alpha', kind: 'alpha', unit: '(>=1 off)' },
  ],
  sync: [
    { key: 'syncIntervalMs', label: 'Sync interval', kind: 'raw', unit: 'ms' },
    { key: 'displayIntervalMs', label: 'Display interval', kind: 'raw', unit: 'ms' },
  ],
};

// A plain space and a '-' glyph are NOT the same rendered width in a
// proportional font (tabular-nums only equalizes DIGITS, not the sign) -
// swapping one character for the other still shifted everything after it.
// Fixed properly: the sign always renders inside its own fixed-width
// inline-block span (see .signSlot), so its box is the same width whether
// it's empty or holds '-', and nothing after it ever moves. Returns HTML,
// not plain text - callers must assign via .innerHTML, not .textContent.
function fixedNumHtml(value, intDigits, decDigits) {
  const negative = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(decDigits);
  const dot = fixed.indexOf('.');
  const intPart = (dot === -1 ? fixed : fixed.slice(0, dot)).padStart(intDigits, '0');
  const decPart = dot === -1 ? '' : fixed.slice(dot);
  return '<span class="signSlot">' + (negative ? '-' : '') + '</span>' + intPart + decPart;
}

function toDisplay(kind, raw) {
  switch (kind) {
    case 'volts': return (raw / 100).toFixed(2);
    case 'seconds': return (raw / 1000).toFixed(3);
    case 'tenthPct': return (raw / 10).toFixed(1);
    case 'tenthMm': return (raw / 10).toFixed(1);
    case 'ratio': return (raw / 100).toFixed(3);
    case 'alpha': return (raw / 1000).toFixed(3);
    case 'floatRaw': return raw;
    case 'mmPerMin': return Math.round(raw * 60 / currentStepsPerMm());
    case 'mode': return raw;
    case 'bool': return raw ? 'true' : 'false';
    default: return raw;
  }
}

function toRaw(kind, value) {
  switch (kind) {
    case 'volts': return Math.round(parseFloat(value) * 100);
    case 'seconds': return Math.round(parseFloat(value) * 1000);
    case 'tenthPct': return Math.round(parseFloat(value) * 10);
    case 'tenthMm': return Math.round(parseFloat(value) * 10);
    case 'ratio': return Math.round(parseFloat(value) * 100);
    case 'alpha': return Math.round(parseFloat(value) * 1000);
    case 'floatRaw': return parseFloat(value);
    case 'mmPerMin': return Math.round(parseFloat(value) * currentStepsPerMm() / 60);
    case 'mode': return parseInt(value, 10);
    case 'bool': return value === 'true';
    default: return parseInt(value, 10);
  }
}

function currentStepsPerMm() {
  return (latest && latest.thc && latest.thc.stepsPerMm) ? latest.thc.stepsPerMm : 200;
}

// A segmented control in place of a native <select>: drawn inside the page, so
// it scales with it. A hidden input keeps the chosen value where the Send code
// already reads it (`#<id>.value`).
function segHtml(id, options, initial) {
  return '<span class="seg" role="radiogroup"><input type="hidden" id="' + id + '" value="' + initial + '">' +
    options.map((o) => '<button type="button" class="segBtn' + (o[0] === initial ? ' on' : '') + '" role="radio" aria-checked="' +
      (o[0] === initial) + '" data-segfor="' + id + '" data-value="' + o[0] + '">' + o[1] + '</button>').join('') + '</span>';
}

function buildTable(group) {
  const table = $(group + 'Table');
  let html = '<tr><th>Setting</th><th>Current</th><th>New value</th><th></th></tr>';
  FIELDS[group].forEach((f) => {
    const id = group + '_' + f.key;
    let inputHtml;
    if (f.kind === 'bool') {
      inputHtml = segHtml(id + '_in', [['false', 'false'], ['true', 'true']], 'false');
    } else if (f.kind === 'mode') {
      inputHtml = segHtml(id + '_in', [['0', '0 off'], ['1', '1 avg'], ['2', '2 fixed']], '0');
    } else {
      inputHtml = '<input type="text" id="' + id + '_in">';
    }
    const labelAttr = f.hint ? ' title="' + f.hint + '" style="cursor:help; text-decoration:underline dotted;"' : '';
    html += '<tr><td' + labelAttr + '>' + f.label + '</td>' +
            '<td class="curcol" id="' + id + '_cur">-</td>' +
            '<td>' + inputHtml + ' ' + f.unit + '</td>' +
            '<td><button class="setbtn" data-group="' + group + '" data-key="' + f.key + '" data-kind="' + f.kind + '">Send</button></td></tr>';
  });
  table.innerHTML = html;
  table.querySelectorAll('.segBtn').forEach((btn) => {
    btn.onclick = () => {
      $(btn.dataset.segfor).value = btn.dataset.value;
      btn.parentNode.querySelectorAll('.segBtn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
    };
  });
  table.querySelectorAll('button[data-group]').forEach((btn) => {
    btn.onclick = () => {
      const group = btn.dataset.group, key = btn.dataset.key, kind = btn.dataset.kind;
      const inputEl = $(group + '_' + key + '_in');
      const raw = toRaw(kind, inputEl.value);
      const payload = {};
      payload[group] = {};
      payload[group][key] = raw;
      send(payload);
    };
  });
}

['thc', 'movement', 'voltage', 'sync'].forEach(buildTable);

// ---- Rolling 3s voltage graph (Voltage tab) ------------------------------
// Buffered from EVERY telemetry frame (see the pushVoltSample() call in
// ws.onmessage, placed BEFORE the displayIntervalMs throttle) - short-term
// noise/ripple is exactly what this graph exists to show, and the default
// 250ms display throttle would otherwise flatten it out.
const VOLT_HISTORY_MS = 3000;
let voltHistory = [];  // [{t: performance.now() at receipt, v: raw plasmaVoltage}]
let voltAxisMin = null, voltAxisMax = null;  // eased toward the target range each redraw
let lastVoltGraphDraw = 0;

function pushVoltSample(rawVoltage) {
  const now = performance.now();
  voltHistory.push({ t: now, v: rawVoltage });
  const cutoff = now - VOLT_HISTORY_MS;
  while (voltHistory.length && voltHistory[0].t < cutoff) voltHistory.shift();
  // Redraw throttled to ~25fps regardless of telemetry rate (which can run
  // into the hundreds of Hz at a fast syncIntervalMs) - plenty smooth for a
  // scrolling line, far less DOM churn than redrawing every frame.
  if (now - lastVoltGraphDraw >= 40) {
    renderVoltGraph();
    lastVoltGraphDraw = now;
  }
}

// Drawn 1:1 in CSS pixels at whatever width the card gives the chart (180-460),
// so axis text stays readable in a narrow plugin window instead of the whole
// 460-wide drawing being scaled down with it. Hidden tabs report 0 width -
// those fall back to 460 and redraw correctly when the tab is shown.
function chartWidth(svg) {
  return Math.max(180, Math.min(460, Math.round(svg.clientWidth || 460)));
}

function renderVoltGraph() {
  const svg = $('voltGraphSvg');
  if (!svg) return;
  const now = performance.now();
  const cutoff = now - VOLT_HISTORY_MS;
  const points = voltHistory.filter((p) => p.t >= cutoff);

  if (points.length < 2) {
    svg.innerHTML = '<text x="10" y="20" class="curveMsg">Waiting for telemetry...</text>';
    $('voltGraphRange').textContent = '--';
    return;
  }

  const volts = points.map((p) => p.v / 100);
  const dataMin = Math.min(...volts), dataMax = Math.max(...volts);
  // At least a few volts of padding/minimum span, or idle noise of a few
  // hundredths of a volt would zoom in to an unreadably thin sliver -
  // otherwise the range hugs the actual signal tightly, expanding as
  // voltage rises and contracting again once it settles/the torch goes
  // off, instead of a fixed axis that's too coarse to see anything at
  // idle (the specific thing this graph is for).
  const pad = Math.max(2, (dataMax - dataMin) * 0.15);
  let targetMin = dataMin - pad, targetMax = dataMax + pad;
  const MIN_SPAN = 4;
  if (targetMax - targetMin < MIN_SPAN) {
    const mid = (targetMax + targetMin) / 2;
    targetMin = mid - MIN_SPAN / 2;
    targetMax = mid + MIN_SPAN / 2;
  }
  // Eased rather than snapped straight to the target, so the axis expands/
  // contracts smoothly instead of visibly jumping every redraw.
  const EASE = 0.15;
  voltAxisMin = voltAxisMin === null ? targetMin : voltAxisMin + (targetMin - voltAxisMin) * EASE;
  voltAxisMax = voltAxisMax === null ? targetMax : voltAxisMax + (targetMax - voltAxisMax) * EASE;

  const W = chartWidth(svg), H = 220, ML = 48, MR = 10, MT = 10, MB = 22;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const PW = W - ML - MR, PH = H - MT - MB;
  const px = (t) => ML + PW * (1 - (now - t) / VOLT_HISTORY_MS);
  const py = (v) => MT + PH - ((v - voltAxisMin) / (voltAxisMax - voltAxisMin)) * PH;

  let d = '';
  points.forEach((p, i) => {
    d += (i === 0 ? 'M' : 'L') + px(p.t).toFixed(1) + ',' + py(p.v / 100).toFixed(1) + ' ';
  });

  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const gv = voltAxisMin + ((voltAxisMax - voltAxisMin) * i) / 3;
    const yp = py(gv).toFixed(1);
    grid += '<line x1="' + ML + '" y1="' + yp + '" x2="' + (ML + PW) + '" y2="' + yp + '" class="curveGrid"/>';
    grid += '<text x="' + (ML - 6) + '" y="' + (Number(yp) + 3) + '" class="curveAxisLabel" text-anchor="end">' + gv.toFixed(1) + '</text>';
  }
  ['-3s', '-2s', '-1s', 'now'].forEach((label, i) => {
    const xp = ML + (PW * i) / 3;
    grid += '<line x1="' + xp + '" y1="' + MT + '" x2="' + xp + '" y2="' + (MT + PH) + '" class="curveGrid"/>';
    grid += '<text x="' + xp + '" y="' + (MT + PH + 14) + '" class="curveAxisLabel" text-anchor="' + (i === 0 ? 'start' : i === 3 ? 'end' : 'middle') + '">' + label + '</text>';
  });

  svg.innerHTML =
    grid +
    '<line x1="' + ML + '" y1="' + (MT + PH) + '" x2="' + (ML + PW) + '" y2="' + (MT + PH) + '" class="curveAxis"/>' +
    '<line x1="' + ML + '" y1="' + MT + '" x2="' + ML + '" y2="' + (MT + PH) + '" class="curveAxis"/>' +
    '<path d="' + d + '" class="curvePathProposed"/>';

  $('voltGraphRange').textContent = voltAxisMin.toFixed(1) + '-' + voltAxisMax.toFixed(1) + ' V';
}

// ---- Movement speed-curve preview ----------------------------------------
// Reimplements the EXACT formula from process() in main.cpp (not a rough
// approximation): newSpeed = a*|voltdiff|^exp + b, where a/b are solved so
// the curve passes through (minVoltage,minSpeed) and (maxVoltage,maxSpeed),
// then clamped to [minSpeed, ultimateMax] - matches main.cpp's own
// `a = (maxSpeed-minSpeed)/(maxV^exp-minV^exp)`,
// `b = minSpeed - a*minV^exp`, `newSpeed = clamp(a*|x|^exp+b, minSpeed, ultimateMax)`
// bit for bit, just evaluated in human units (V, mm/min) for the graph
// instead of the firmware's raw wire units - same curve shape/anchor
// points either way since scale only shifts where a and b land, not what
// the plotted curve looks like relative to its own axes.
//
// Reads one movement field in HUMAN units (V, mm/min, raw exponent).
// useTyped=true prefers whatever's currently typed in that field's input,
// falling back to the last confirmed live value - this is the "proposed"
// curve (what you'd get if you hit Send). useTyped=false always uses the
// live telemetry value regardless of what's typed - the "current" curve
// (what's actually applied on the THC right now), for comparison.
function movementValueFor(key, useTyped) {
  const f = FIELDS.movement.find((x) => x.key === key);
  if (useTyped) {
    const el = $('movement_' + key + '_in');
    if (el && el.value !== '') {
      const v = parseFloat(el.value);
      if (!isNaN(v)) return v;
    }
  }
  const m = (latest && latest.movement) ? latest.movement[key] : undefined;
  if (m === undefined) return null;
  return parseFloat(toDisplay(f.kind, m));
}

function movementSnapshot(useTyped) {
  return {
    exp: movementValueFor('exp', useTyped),
    minV: movementValueFor('minVoltage', useTyped),
    maxV: movementValueFor('maxVoltage', useTyped),
    minS: movementValueFor('minSpeed', useTyped),
    maxS: movementValueFor('maxSpeed', useTyped),
    ultimateMax: movementValueFor('ultimateMax', useTyped),
  };
}

function snapshotValid(s) {
  return Object.values(s).every((v) => v !== null && !isNaN(v)) && s.maxV > s.minV && s.ultimateMax > 0;
}

function snapshotsEqual(a, b) {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

function curveCoeffs(s) {
  const denom = Math.pow(s.maxV, s.exp) - Math.pow(s.minV, s.exp);
  const a = denom !== 0 ? (s.maxS - s.minS) / denom : 0;
  const b = s.minS - a * Math.pow(s.minV, s.exp);
  return { a, b };
}

function curveSpeedAt(s, coeffs, x) {
  return Math.min(s.ultimateMax, Math.max(s.minS, coeffs.a * Math.pow(Math.abs(x), s.exp) + coeffs.b));
}

// Just for picking a sensible plot width - the x where the curve would
// reach ultimateMax, if that happens within a sane range beyond maxV.
function curveXAtUltimate(s, coeffs) {
  if (coeffs.a > 0 && s.ultimateMax > s.minS) {
    const t = (s.ultimateMax - coeffs.b) / coeffs.a;
    if (t > 0) {
      const x = Math.pow(t, 1 / s.exp);
      if (isFinite(x) && x > s.maxV) return x;
    }
  }
  return s.maxV;
}

function renderMovementCurve() {
  const svg = $('curveSvg');
  if (!svg) return;

  const current = movementSnapshot(false);
  const proposedRaw = movementSnapshot(true);
  const currentOk = snapshotValid(current);
  let proposedOk = snapshotValid(proposedRaw);
  // If nothing's typed (or it matches current exactly), there's nothing to
  // compare - draw current alone rather than two overlapping identical
  // lines.
  const showBoth = currentOk && proposedOk && !snapshotsEqual(current, proposedRaw);

  if (!currentOk && !proposedOk) {
    svg.innerHTML =
      '<text x="10" y="20" class="curveMsg">Need valid min/max voltage,</text>' +
      '<text x="10" y="38" class="curveMsg">min/max speed and ultimate max.</text>' +
      '<text x="10" y="56" class="curveMsg">Waiting on a telemetry frame, or</text>' +
      '<text x="10" y="74" class="curveMsg">type values in the fields above.</text>';
    return;
  }

  const primary = proposedOk ? proposedRaw : current;
  const primaryCoeffs = curveCoeffs(primary);
  const currentCoeffs = currentOk ? curveCoeffs(current) : null;

  const domainsOf = (s, coeffs) => [s.maxV * 1.15, curveXAtUltimate(s, coeffs) * 1.08, s.ultimateMax * 1.1];
  let [xMax, xUlt, yMax] = domainsOf(primary, primaryCoeffs);
  if (showBoth) {
    const [cxMax, cxUlt, cyMax] = domainsOf(current, currentCoeffs);
    xMax = Math.max(xMax, cxMax, cxUlt * 1.08);
    yMax = Math.max(yMax, cyMax);
  }
  xMax = Math.max(xMax, xUlt, primary.minV + 1);

  const W = chartWidth(svg), H = 300, ML = 50, MB = 26, MT = 10, MR = 12;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const PW = W - ML - MR, PH = H - MT - MB;
  const px = (x) => ML + (x / xMax) * PW;
  const py = (y) => MT + PH - (y / yMax) * PH;

  const pathFor = (s, coeffs) => {
    const N = 90;
    let d = '';
    for (let i = 0; i <= N; i++) {
      const x = (xMax * i) / N;
      d += (i === 0 ? 'M' : 'L') + px(x).toFixed(1) + ',' + py(curveSpeedAt(s, coeffs, x)).toFixed(1) + ' ';
    }
    return d;
  };

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gx = (xMax * i) / 4, gy = (yMax * i) / 4;
    const xp = px(gx).toFixed(1), yp = py(gy).toFixed(1);
    grid += '<line x1="' + xp + '" y1="' + MT + '" x2="' + xp + '" y2="' + (MT + PH) + '" class="curveGrid"/>';
    grid += '<line x1="' + ML + '" y1="' + yp + '" x2="' + (ML + PW) + '" y2="' + yp + '" class="curveGrid"/>';
    grid += '<text x="' + xp + '" y="' + (MT + PH + 16) + '" class="curveAxisLabel" text-anchor="middle">' + gx.toFixed(1) + '</text>';
    grid += '<text x="' + (ML - 6) + '" y="' + (Number(yp) + 3) + '" class="curveAxisLabel" text-anchor="end">' + Math.round(gy) + '</text>';
  }

  const dot = (x, y, color, r) =>
    '<circle cx="' + px(x).toFixed(1) + '" cy="' + py(y).toFixed(1) + '" r="' + r + '" fill="' + color + '" stroke="var(--plugin-surface-raised)" stroke-width="1.5"/>';
  const label = (x, y, text, anchor, dy) =>
    '<text x="' + (px(x) + (anchor === 'end' ? -8 : 8)).toFixed(1) + '" y="' + (py(y) + dy).toFixed(1) +
    '" class="curveAxisLabel" text-anchor="' + anchor + '" font-weight="700">' + text + '</text>';

  let svgContent = grid +
    '<line x1="' + ML + '" y1="' + (MT + PH) + '" x2="' + (ML + PW) + '" y2="' + (MT + PH) + '" class="curveAxis"/>' +
    '<line x1="' + ML + '" y1="' + MT + '" x2="' + ML + '" y2="' + (MT + PH) + '" class="curveAxis"/>';

  if (showBoth) {
    svgContent += '<path d="' + pathFor(current, currentCoeffs) + '" class="curvePathCurrent"/>';
    svgContent += dot(current.minV, current.minS, 'var(--plugin-text-muted)', 3);
    svgContent += dot(current.maxV, current.maxS, 'var(--plugin-text-muted)', 3);
  }

  svgContent += '<path d="' + pathFor(primary, primaryCoeffs) + '" class="curvePathProposed"/>';
  svgContent += dot(primary.minV, primary.minS, 'var(--plugin-danger)', 4.5);
  svgContent += dot(primary.maxV, primary.maxS, 'var(--plugin-good)', 4.5);
  svgContent += label(primary.minV, primary.minS, primary.minV.toFixed(2) + 'V, ' + Math.round(primary.minS), 'end', -8);
  svgContent += label(primary.maxV, primary.maxS, primary.maxV.toFixed(2) + 'V, ' + Math.round(primary.maxS), 'start', -8);

  svgContent +=
    '<text x="' + (ML + PW / 2) + '" y="' + (H - 2) + '" class="curveAxisTitle" text-anchor="middle">|&#916;V| (V)</text>' +
    '<text x="4" y="' + (MT + 10) + '" class="curveAxisTitle">mm/min</text>';

  if (showBoth) {
    // Side by side when there's room, stacked in a narrow window.
    const stacked = W < 330;
    const x2 = stacked ? ML + 6 : ML + 108, y2 = stacked ? H - 28 : H - 14;
    svgContent +=
      '<line x1="' + (ML + 6) + '" y1="' + (H - 14) + '" x2="' + (ML + 26) + '" y2="' + (H - 14) + '" class="curvePathCurrent"/>' +
      '<text x="' + (ML + 30) + '" y="' + (H - 11) + '" class="curveAxisLabel">applied now</text>' +
      '<line x1="' + x2 + '" y1="' + y2 + '" x2="' + (x2 + 20) + '" y2="' + y2 + '" class="curvePathProposed"/>' +
      '<text x="' + (x2 + 24) + '" y="' + (y2 + 3) + '" class="curveAxisLabel">proposed</text>';
  }

  svg.innerHTML = svgContent;
}

FIELDS.movement.forEach((f) => {
  const el = $('movement_' + f.key + '_in');
  if (el) el.addEventListener('input', renderMovementCurve);
});
renderMovementCurve();

// Accepts what people actually paste: "10.0.2.146", "10.0.2.146:80",
// "http://10.0.2.146/", "ws://10.0.2.146/ws".
function normalizeHost(raw) {
  return raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
}

function connect() {
  const host = normalizeHost($('host').value);
  $('host').value = host;
  if (!host) {
    $('linkHint').textContent = 'Enter the THC\'s IP address first.';
    setView('link');
    $('host').focus();
    return;
  }
  pluginSettings.thcHost = host;
  savePluginSettings();
  if (ws) { const old = ws; ws = null; old.close(); }

  // Fresh link = fresh counters, and no stale frame left around for jog/
  // preset-snapshot code to mistake for current data from this THC.
  latest = null; frameCount = 0; gapCount = 0; lastSeq = null; lastFrameAt = 0;
  resetTestRunTracker();
  clearSetpointPending();
  closeSetpointEdit();
  $('dHost').textContent = host;
  leaveLinkOnConnect = true;

  const url = 'ws://' + host + '/ws';
  setStatus('connecting...', false);
  let sock;
  try {
    sock = new WebSocket(url);
  } catch (e) {
    setStatus('error - bad address', false);
    leaveLinkOnConnect = false;
    $('linkHint').textContent = 'That address can\'t be used: ' + url;
    return;
  }
  ws = sock;

  // Each handler ignores events from a socket that's no longer the current
  // one - closing the previous socket fires its onclose AFTER the new one
  // exists, which used to flip the status back to "disconnected".
  sock.onopen = () => {
    if (ws !== sock) return;
    setStatus('connected', true);
    if (leaveLinkOnConnect && currentView === 'link') setView('operate');
    leaveLinkOnConnect = false;
  };
  sock.onclose = () => { if (ws === sock) { setStatus('disconnected', false); leaveLinkOnConnect = false; } };
  sock.onerror = () => {
    if (ws !== sock) return;
    setStatus('error - could not reach THC', false);
    leaveLinkOnConnect = false;
    $('linkHint').textContent = 'Could not open ' + url + '. Check the address and that this computer can reach the THC. ' +
      '(A dashboard served over https cannot open ws:// connections.)';
  };

  sock.onmessage = (evt) => {
    if (ws !== sock) return;
    let frame;
    try { frame = JSON.parse(evt.data); } catch (e) { console.error('bad frame', evt.data); return; }

    if (frame.type === 'log') {
      handleLogBatch(frame);
      return;
    }

    latest = frame;
    lastFrameAt = performance.now();
    frameCount++;
    // Buffered at FULL telemetry rate, not gated by the displayIntervalMs
    // throttle below (which is only meant to limit how often the stat
    // tiles repaint) - the whole point of this graph is fast/short-term
    // voltage behavior, which a 250ms-default display throttle would
    // otherwise flatten out.
    pushVoltSample(frame.plasmaVoltage);
    trackTestRun(frame);   // every frame, like the graph - not gated by the display throttle
    checkSetpointEcho(frame);

    if (lastSeq !== null && frame.seq !== lastSeq + 1) {
      gapCount += (frame.seq - lastSeq - 1);
    }
    lastSeq = frame.seq;
    $('frameInfo').textContent = frameCount + ' frames · seq ' + lastSeq + ' · ' + gapCount + ' gap(s)';

    const displayMs = (frame.sync && frame.sync.displayIntervalMs) ? frame.sync.displayIntervalMs : 0;
    const now = performance.now();
    if (now - lastRenderTime >= displayMs) {
      render(frame);
      lastRenderTime = now;
    }
  };
}

function setPill(id, on) {
  const el = $(id);
  el.classList.toggle('on', !!on);
}

const MODE_BTN_IDS = ['modeOffBtn', 'modeAvgBtn', 'modePresetBtn'];

function render(f) {
  $('rPlasma').innerHTML = fixedNumHtml(f.plasmaVoltage / 100, 3, 2) + ' V';
  $('rSetpoint').innerHTML = fixedNumHtml(f.thc.setpointVoltage / 100, 3, 2) + ' V';
  // Compact readout for the Settings page, where the big Operate tiles
  // aren't on screen - so you can watch what a change does to the live
  // voltage/mode without flipping workspaces.
  $('stripV').innerHTML = fixedNumHtml(f.plasmaVoltage / 100, 3, 2) + ' V';
  $('stripSp').innerHTML = fixedNumHtml(f.thc.setpointVoltage / 100, 3, 2) + ' V';
  const modeTag = $('stripMode');
  modeTag.dataset.mode = String(f.thc.mode);
  modeTag.textContent = ['OFF', 'AVG', 'PRE-SET'][f.thc.mode] || ('MODE ' + f.thc.mode);
  $('rOutput').textContent = f.output;
  const zDir = f.output > 0 ? 'Up' : f.output < 0 ? 'Down' : 'Ok';
  $('zDirUp').classList.toggle('active', zDir === 'Up');
  $('zDirOk').classList.toggle('active', zDir === 'Ok');
  $('zDirDown').classList.toggle('active', zDir === 'Down');
  $('rPos').textContent = f.currentPosition.toFixed(2) + ' mm';
  $('rTestVoltage').innerHTML = fixedNumHtml(f.avgTestVoltage / 100, 3, 2) + ' V';
  $('calOffsetReadout').innerHTML = fixedNumHtml(f.voltage.calibrationOffset / 100, 3, 2) + ' V';
  $('calibrateBtn').classList.toggle('calibrated', f.voltage.calibrationOffset !== 0);

  setPill('pArcOk', f.statusLEDs.arcOk);
  setPill('pCoolant', f.statusLEDs.coolantOn);
  setPill('pAntidive', f.statusLEDs.antidiveActive);
  setPill('pVoidsense', f.statusLEDs.voidSenseActive);
  setPill('pCut', f.inTHCCut);
  setPill('pTest', f.inTestRun);

  // Mode buttons reflect the THC's own echoed mode (f.thc.mode), same
  // "only trust telemetry" rule as everything else - clicking sends the
  // command, the fill only follows once the THC actually confirms it.
  MODE_BTN_IDS.forEach((id, i) => $(id).classList.toggle('active', f.thc.mode === i));

  // testRun toggle reflects the settable thc.testRun flag (what the button
  // actually commands), NOT inTestRun (the read-only "a test run is
  // actively happening right now" pill above) - these can briefly differ,
  // e.g. right after setting the flag but before mode/conditions line up
  // for the THC to actually enter test-run.
  const testRunBtn = $('testRunBtn');
  testRunBtn.textContent = 'Test run: ' + (f.thc.testRun ? 'ON' : 'OFF');
  testRunBtn.classList.toggle('on', f.thc.testRun);

  const interlocked = f.statusLEDs.arcOk || f.statusLEDs.coolantOn || f.inTHCCut || f.inTestRun;
  const banner = $('interlockBanner');
  banner.textContent = interlocked ? 'Interlock ACTIVE - jog/calibrate rejected' : 'Interlock clear - jog/calibrate allowed';
  banner.classList.toggle('active', interlocked);
  const lockTag = $('stripLock');
  lockTag.textContent = interlocked ? 'Interlock ACTIVE' : 'Interlock clear';
  lockTag.classList.toggle('active', interlocked);

  ['thc', 'movement', 'voltage', 'sync'].forEach((group) => {
    FIELDS[group].forEach((fld) => {
      const raw = f[group][fld.key];
      const el = $(group + '_' + fld.key + '_cur');
      if (el) el.textContent = toDisplay(fld.kind, raw) + (fld.unit && fld.kind !== 'bool' && fld.kind !== 'mode' ? ' ' + fld.unit : '');
    });
  });

  updateAvgWarn(f);
  if (spEditing) updateSpDelta();   // the THC's value can change under an open editor
  $('raw').textContent = JSON.stringify(f, null, 2);

  // Only refreshes the fallback values movementHumanValue() uses for
  // fields left blank - anything currently typed still takes precedence,
  // so a live telemetry update never overwrites an in-progress edit.
  renderMovementCurve();
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { notify('Not connected to the THC.', true); return false; }
  ws.send(JSON.stringify(obj));
  return true;
}

$('connectBtn').onclick = connect;
$('forgetBtn').onclick = () => {
  const host = normalizeHost($('host').value);
  if (!host) { notify('Enter the THC\'s IP address first.', true); return; }
  askConfirm('Clear the saved WiFi credentials on ' + host + ' and reboot it into its setup AP?', 'Forget & reboot', () => {
    fetch('http://' + host + '/api/wifi/forget', { method: 'POST' })
      .then(() => notify('Sent. The THC should reboot into "THC-Setup" - join that network to reconfigure.'))
      .catch((e) => notify('Request failed (the THC may already be rebooting): ' + e, true));
  });
};

// moveZ is raw tenths-of-mm on the wire; the firmware applies whatever
// signed value it's given directly (it does not scale by updownAmt
// itself) - always use the live updownAmt from telemetry, never a
// hardcoded amount.
function jogAmount() {
  return (latest && latest.thc) ? latest.thc.updownAmt : null;
}
$('jogDown').onclick = () => {
  const amt = jogAmount();
  if (amt === null) { notify('Wait for at least one telemetry frame first.', true); return; }
  send({ moveZ: -amt });
};
$('jogUp').onclick = () => {
  const amt = jogAmount();
  if (amt === null) { notify('Wait for at least one telemetry frame first.', true); return; }
  send({ moveZ: amt });
};
$('calibrateBtn').onclick = () => send({ calibrate: true });
// The big Current voltage readout is a second Calibrate button: exactly the
// same command (the firmware still refuses it during an arc, cut or test run).
$('currentTile').addEventListener('click', () => $('calibrateBtn').click());
$('currentTile').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('calibrateBtn').click(); }
});

// Mode select (thc.mode: 0=off, 1=averaging/AVG, 2=fixed/PRE-SET) and the
// Test run toggle (thc.testRun) - same one-click-send pattern as every
// other command on this page, no extra confirmation beyond what the
// equivalent field-table Send buttons already had.
$('modeOffBtn').onclick = () => send({ thc: { mode: 0 } });
$('modeAvgBtn').onclick = () => send({ thc: { mode: 1 } });
$('modePresetBtn').onclick = () => send({ thc: { mode: 2 } });
$('testRunBtn').onclick = () => {
  const cur = (latest && latest.thc) ? latest.thc.testRun : false;
  send({ thc: { testRun: !cur } });
};

// ---- Burst datalog (decoupled from syncIntervalMs) -----------------------
const CSV_HEADER = 'Time(ms), Voltage, Set Voltage, Arc OK, Test Run, THC Cut, Cur Posit, Output, Arc_SmplsCnt, Spindle %, THC On, AntiDv Act';
// A plugin window can stay open for days, so an unattended recording must not
// grow without bound (~130 rows/s at the default settings = ~13 min).
const MAX_LOG_ROWS = 100000;
let recording = false;
let csvRows = [];

// The button is the recording indicator too: red and "Stop recording" while
// rows are being captured, so it can't be left running unnoticed.
function setRecording(on) {
  recording = on;
  $('recordBtn').textContent = on ? 'Stop recording' : 'Start recording';
  $('recordBtn').classList.toggle('recording', on);
  updateRecBadge();
}

// Pinned under the nav on every page while recording, so a recording can't be
// forgotten about on Settings/Link. Tapping it stops the recording (starting
// stays on the Datalog card - it clears the previous log, so it's deliberate).
function updateRecBadge() {
  const badge = $('recBadge');
  badge.hidden = !recording;
  if (recording) badge.textContent = '● REC · ' + csvRows.length + ' rows · tap to stop';
}
$('recBadge').onclick = () => setRecording(false);

function handleLogBatch(frame) {
  if (!recording || !frame.rows) return;
  for (const r of frame.rows) {
    csvRows.push([r.t, r.v, r.sp, +r.arc, +r.test, +r.cut, r.pos, r.out, r.n, r.spwm, +r.cool, +r.adive].join(','));
  }
  $('recCount').textContent = csvRows.length;
  updateRecBadge();
  if (csvRows.length >= MAX_LOG_ROWS) {
    setRecording(false);
    notify('Recording stopped at ' + MAX_LOG_ROWS + ' rows - save the CSV, then start a new recording.', true);
  }
}

function saveCsv() {
  const name = 'thc_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
  exportText(name, 'THC datalog CSV', CSV_HEADER + '\n' + csvRows.join('\n') + '\n');
}

$('recordBtn').onclick = () => {
  setRecording(!recording);
  if (recording) {
    csvRows = [];
    $('recCount').textContent = '0';
    updateRecBadge();
  }
};
$('downloadLogBtn').onclick = () => {
  if (csvRows.length === 0) { notify('Nothing recorded yet.', true); return; }
  saveCsv();
};

// ---- Setpoint: tap the tile to change it -------------------------------------
// Edits in place; nothing is sent until the check mark. Like every command on
// this page the tile then shows what the THC reports back, not what was
// typed: it says "-> x V (waiting...)" until a telemetry frame carries that
// value. The setpoint is not interlocked in the firmware (only jog and
// calibrate are), so it can be changed mid-cut, exactly as on the Sunton.
const SETPOINT_MAX_V = 500;   // typo guard, far above any real arc voltage
let spPending = null;         // { raw, timer }
let spEditing = false;

function liveSetpointRaw() {
  return latest && latest.thc ? latest.thc.setpointVoltage : null;
}

function clearSetpointPending() {
  if (spPending) clearTimeout(spPending.timer);
  spPending = null;
  $('spPending').hidden = true;
}

function showSetpointPending(raw) {
  clearSetpointPending();
  const el = $('spPending');
  el.classList.remove('warn');
  el.textContent = '→ ' + (raw / 100).toFixed(2) + ' V (waiting for the THC)...';
  el.hidden = false;
  const pending = { raw, timer: null };
  pending.timer = setTimeout(() => {
    el.classList.add('warn');
    el.textContent = 'Not confirmed by the THC yet - showing its value';
    pending.timer = setTimeout(clearSetpointPending, 4000);
  }, 2000);
  spPending = pending;
}

// Every telemetry frame (not the display throttle): clears the pending note as
// soon as the THC's own value matches.
function checkSetpointEcho(f) {
  if (spPending && f.thc && f.thc.setpointVoltage === spPending.raw) clearSetpointPending();
}

// One route for every "set the setpoint" action - the tile editor and the
// window-average Use buttons. Returns false if nothing was sent.
function requestSetpoint(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return false;
  const connected = !!(ws && ws.readyState === WebSocket.OPEN);
  send({ thc: { setpointVoltage: raw } });
  if (!connected) return false;
  showSetpointPending(raw);
  return true;
}

function parseSetpointInput() {
  const v = parseFloat($('spInput').value.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function updateSpDelta() {
  const el = $('spDelta');
  const v = parseSetpointInput(), live = liveSetpointRaw();
  el.classList.remove('bad');
  if (v === null) { el.textContent = 'Enter a voltage'; el.classList.add('bad'); return; }
  if (v <= 0 || v > SETPOINT_MAX_V) {
    el.textContent = 'Must be above 0 and at most ' + SETPOINT_MAX_V + ' V';
    el.classList.add('bad');
    return;
  }
  if (live == null) { el.textContent = ''; return; }
  const d = Math.round(v * 100) - live;
  el.textContent = d === 0 ? 'No change' : (d > 0 ? '+' : '') + (d / 100).toFixed(2) + ' V from ' + (live / 100).toFixed(2) + ' V';
}

function openSetpointEdit() {
  if (spEditing) return;
  spEditing = true;
  $('setpointTile').classList.add('editing');
  $('spEdit').hidden = false;
  const live = liveSetpointRaw();
  $('spInput').value = live != null ? (live / 100).toFixed(2) : '';
  updateSpDelta();
  $('spInput').focus();
  $('spInput').select();
}

function closeSetpointEdit() {
  if (!spEditing) return;
  spEditing = false;
  $('setpointTile').classList.remove('editing');
  $('spEdit').hidden = true;
}

function nudgeSetpoint(step) {
  let v = parseSetpointInput();
  if (v === null) { const live = liveSetpointRaw(); v = live != null ? live / 100 : 0; }
  v = Math.min(SETPOINT_MAX_V, Math.max(0.01, Math.round((v + step) * 100) / 100));
  $('spInput').value = v.toFixed(2);
  updateSpDelta();
}

function commitSetpointEdit() {
  const v = parseSetpointInput();
  if (v === null || v <= 0 || v > SETPOINT_MAX_V) { updateSpDelta(); $('spInput').focus(); return; }
  if (requestSetpoint(Math.round(v * 100))) closeSetpointEdit();
}

$('setpointTile').addEventListener('click', (e) => {
  if (!e.target.closest('#spEdit')) openSetpointEdit();
});
$('setpointTile').addEventListener('keydown', (e) => {
  if (e.target === $('setpointTile') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSetpointEdit(); }
});
document.querySelectorAll('#spEdit [data-nudge]').forEach((b) => {
  b.onclick = () => nudgeSetpoint(parseFloat(b.dataset.nudge));
});
$('spInput').addEventListener('input', updateSpDelta);
$('spInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitSetpointEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSetpointEdit(); }
});
$('spOk').onclick = commitSetpointEdit;
$('spCancel').onclick = closeSetpointEdit;
// Tapping anywhere else abandons the edit - nothing was sent.
document.addEventListener('pointerdown', (e) => {
  if (spEditing && !e.target.closest('#setpointTile')) closeSetpointEdit();
});

// ---- Test-run window averages (kept as a list) ------------------------------
// The THC doesn't average once: after the arc-stabilize + pierce delays a test
// run measures back-to-back windows of the averaging time (thc.testCutTime)
// until the arc drops, and every finished window overwrites avgTestVoltage and
// restarts sampleCount from 0. The big tile therefore only ever shows the
// latest one; this list keeps all of them so they can be compared. Derived
// purely from the telemetry that is already streaming - nothing on the THC or
// the Sunton changes.
//
// A window has finished when, during a run, sampleCount drops back (new
// window) with a non-zero average showing, or the average itself changes.
// Either alone would miss something: "changed" misses two identical averages
// in a row, "dropped" misses a boundary frame that was never sent. The
// zero-average drop at the end of the arc-stabilize + pierce wait is not a
// window (the THC zeroes avgTestVoltage at run start).
const MAX_AVG_WINDOWS = 1000;
let avgRuns = [];       // [{ id, startedAt: Date, t0: THC millis, windows: [{ raw, n, sec }] }]
let avgRunSeq = 0;
let avgTrack = { inTest: false, count: null, avg: 0, t: 0 };

function resetTestRunTracker() { avgTrack = { inTest: false, count: null, avg: 0, t: 0 }; }

function newAvgRun(t0) {
  avgRunSeq += 1;
  const run = { id: avgRunSeq, startedAt: new Date(), t0: t0, windows: [] };
  avgRuns.push(run);
  return run;
}

function trackTestRun(f) {
  const inTest = !!f.inTestRun;
  const avg = f.avgTestVoltage, count = f.sampleCount;
  const t = f.t != null ? f.t : 0;
  let redraw = false;

  if (inTest && !avgTrack.inTest) {
    newAvgRun(t);
    avgTrack.count = null;
    avgTrack.avg = avg;   // whatever is showing right now is not a new window
    redraw = true;
  } else if (!inTest && avgTrack.inTest) {
    // A run abandoned before its first window finished isn't worth a header.
    const last = avgRuns[avgRuns.length - 1];
    if (last && last.windows.length === 0) {
      avgRuns.pop();
      if (last.id === avgRunSeq) avgRunSeq -= 1;   // keep the run numbers gap-free
    }
    redraw = true;
  }

  if (inTest) {
    const run = avgRuns[avgRuns.length - 1];
    const dropped = avgTrack.count !== null && count < avgTrack.count;
    const moved = avg !== avgTrack.avg;
    if (run && avg > 0 && (dropped || moved)) {
      run.windows.push({
        raw: avg,
        n: f.stDevVoltage > 0 ? Math.round(f.stDevVoltage / 100) : null,   // samples in the window (THC sends it x100)
        sec: Math.max(0, (t - run.t0) / 1000),
      });
      let total = avgRuns.reduce((n, r) => n + r.windows.length, 0);
      while (total > MAX_AVG_WINDOWS && avgRuns.length) {
        if (avgRuns[0].windows.length) { avgRuns[0].windows.shift(); total -= 1; }
        if (!avgRuns[0].windows.length && avgRuns.length > 1) avgRuns.shift();
        else if (!avgRuns[0].windows.length) break;
      }
      redraw = true;
    }
  }

  avgTrack.inTest = inTest;
  avgTrack.count = inTest ? count : null;
  avgTrack.avg = avg;
  avgTrack.t = t;
  if (redraw) renderAvgList();
}

function avgStats(run) {
  const raws = run.windows.map((w) => w.raw);
  const sum = raws.reduce((a, b) => a + b, 0);
  return { n: raws.length, mean: Math.round(sum / raws.length), min: Math.min(...raws), max: Math.max(...raws) };
}

function latestAvgRun() {
  for (let i = avgRuns.length - 1; i >= 0; i--) if (avgRuns[i].windows.length) return avgRuns[i];
  return null;
}

function renderAvgList() {
  let html = '';
  avgRuns.forEach((run) => {
    html += '<tr class="runRow"><th colspan="5">Run ' + run.id + ' &middot; ' + run.startedAt.toLocaleTimeString() +
      (run.windows.length ? '' : ' &middot; waiting for the first window') + '</th></tr>';
    run.windows.forEach((w, i) => {
      html += '<tr><td>' + (i + 1) + '</td><td>' + w.sec.toFixed(1) + ' s</td>' +
        '<td class="avgVal">' + (w.raw / 100).toFixed(2) + ' V</td>' +
        '<td class="colN" title="samples in the window">' + (w.n === null ? '' : w.n + ' smp') + '</td>' +
        '<td><button type="button" class="useBtn" data-raw="' + w.raw + '" title="Send this as the setpoint voltage">Use</button></td></tr>';
    });
  });
  $('avgBody').innerHTML = html;

  const run = latestAvgRun();
  const useMean = $('avgUseMeanBtn');
  if (run) {
    const st = avgStats(run);
    $('avgSummary').textContent = 'Run ' + run.id + ': ' + st.n + ' window' + (st.n === 1 ? '' : 's') + ' - mean ' +
      (st.mean / 100).toFixed(2) + ' V, ' + (st.min / 100).toFixed(2) + '-' + (st.max / 100).toFixed(2) + ' V';
    useMean.textContent = 'Use mean (' + (st.mean / 100).toFixed(2) + ' V) as setpoint';
    useMean.dataset.raw = String(st.mean);
  } else {
    $('avgSummary').textContent = 'No windows yet - start a test run.';
    useMean.textContent = 'Use mean as setpoint';
    delete useMean.dataset.raw;
  }
  useMean.disabled = !run;
  $('avgSaveBtn').disabled = !run;
  $('avgClearBtn').disabled = avgRuns.length === 0;
  const sc = $('avgScroll');
  sc.scrollTop = sc.scrollHeight;   // newest window in view
}

// Setpoint can be sent at any time (only jog/calibrate are interlocked); the
// Setpoint tile only changes once the THC echoes it back.
function useAvgAsSetpoint(raw) {
  requestSetpoint(raw);
}

$('avgBody').onclick = (e) => {
  const b = e.target.closest('button[data-raw]');
  if (b) useAvgAsSetpoint(parseInt(b.dataset.raw, 10));
};
$('avgUseMeanBtn').onclick = () => useAvgAsSetpoint(parseInt($('avgUseMeanBtn').dataset.raw, 10));
$('avgClearBtn').onclick = () => {
  avgRuns = [];
  avgRunSeq = 0;
  // Mid-run, later windows still need a run to land in.
  if (avgTrack.inTest) newAvgRun(avgTrack.t);
  renderAvgList();
};

function testRunCsv() {
  const lines = ['Run,Window,Time into run (s),Avg voltage (V),Samples,Run started'];
  avgRuns.forEach((run) => {
    run.windows.forEach((w, i) => {
      lines.push([run.id, i + 1, w.sec.toFixed(1), (w.raw / 100).toFixed(2), w.n === null ? '' : w.n,
        run.startedAt.toISOString()].join(','));
    });
  });
  return lines.join('\n') + '\n';
}

// Standalone page: plain browser download. (The plugin build swaps this for
// the dashboard's downloadFile bridge, since its sandbox blocks downloads.)
function saveTestRunCsv(filename, text) {
  exportText(filename, 'Test run averages CSV', text);
}

$('avgSaveBtn').onclick = () => {
  if (!latestAvgRun()) return;
  saveTestRunCsv('thc_testrun_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv', testRunCsv());
};

// With telemetry slower than the averaging window, whole windows go by
// between two frames and can't be listed - say so rather than silently drop.
function updateAvgWarn(f) {
  const sync = f.sync ? f.sync.syncIntervalMs : null;
  const win = f.thc ? f.thc.testCutTime : null;
  const risky = sync != null && win != null && sync >= win;
  const el = $('avgWarn');
  el.hidden = !risky;
  if (risky) el.textContent = 'Sync interval (' + sync + ' ms) is not shorter than the averaging time (' + win + ' ms) - some windows can be missed.';
}

renderAvgList();

// ---- Settings presets, loaded from the Sunton's own settings.csv --------
// Column order and every scale factor below are copied verbatim from
// Sunton-ESP32-8048S043/src/settingsLoader.h's loadStoredSettingsFromCSV()
// - that file is the authoritative format. calibrationOffset in particular
// is toInt()*100, NOT toFloat()*100 like the other volts fields - matches
// that file's own asymmetric save-side integer division.
function parsePresetLine(tokens) {
  const f = (i) => parseFloat(tokens[i]);
  const stepsPerMm = parseInt(tokens[12], 10) || 200;
  return {
    name: tokens[0],
    thc: {
      setpointVoltage: Math.round(f(1) * 100),
      tolerance: Math.round(f(2) * 100),
      antidivePct: Math.round(f(3) * 10),
      voidSenseV: Math.round(f(4) * 100),
      arcStabilizeDelay: Math.round(f(5) * 1000),
      pierceDelay: Math.round(f(6) * 1000),
      testCutTime: Math.round(f(7) * 1000),
      firstAvgDist: parseInt(tokens[8], 10),
      updownAmt: Math.round(f(9) * 10),
      delayStartEvent: parseInt(tokens[10], 10),
      mode: parseInt(tokens[11], 10),
      stepsPerMm: stepsPerMm,
      // tokens[13] (testRun) intentionally not loaded - a preset must
      // never silently start a test run.
    },
    movement: {
      exp: f(14),
      minVoltage: Math.round(f(15) * 100),
      maxVoltage: Math.round(f(16) * 100),
      minSpeed: Math.round(f(17) * stepsPerMm / 60),
      maxSpeed: Math.round(f(18) * stepsPerMm / 60),
      ultimateMax: Math.round(f(19) * stepsPerMm / 60),
      tieMinToTolerance: parseInt(tokens[20], 10) !== 0,
    },
    voltage: {
      multifactor: Math.round(f(21) * 100),
      calibrationOffset: parseInt(tokens[22], 10) * 100,
      numAvgReading: parseInt(tokens[23], 10),
      numRealtimeSamples: parseInt(tokens[24], 10),
      expAlpha: Math.round(f(25) * 1000),
    },
    sync: {
      displayIntervalMs: parseInt(tokens[26], 10),
      syncIntervalMs: parseInt(tokens[27], 10),
    },
  };
}

function parseSettingsCsv(text) {
  const presets = [];
  let headerSkipped = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!headerSkipped && (line.startsWith('#') || line.indexOf('setpoint_voltage') !== -1)) {
      headerSkipped = true;
      continue;
    }
    const tokens = line.split(',');
    if (tokens.length < 28) {
      console.warn('preset line skipped, expected 28 fields, got', tokens.length, line);
      continue;
    }
    presets.push(parsePresetLine(tokens));
  }
  return presets;
}

let parsedPresets = [];

const MODE_LABELS = { 0: 'off', 1: 'averaging', 2: 'fixed' };

function formatPresetField(kind, raw) {
  if (kind === 'mode') return raw + ' (' + (MODE_LABELS[raw] || '?') + ')';
  if (kind === 'bool') return raw ? 'true' : 'false';
  return toDisplay(kind, raw);
}

function presetFieldCell(group, f, raw) {
  const unit = (f.unit && f.kind !== 'bool' && f.kind !== 'mode') ? ' ' + f.unit : '';
  return '<td>' + f.label + '</td><td class="curcol">' + formatPresetField(f.kind, raw) + unit + '</td>';
}

function renderPresetPreview(preset) {
  const el = $('presetPreview');
  if (!preset) { el.innerHTML = ''; return; }
  let html = '<table><tr><th colspan="4" style="text-align:left;">Name: ' + esc(preset.name) + '</th></tr>';
  ['thc', 'movement', 'voltage', 'sync'].forEach((group) => {
    const fields = FIELDS[group].filter((f) => preset[group][f.key] !== undefined);
    if (fields.length === 0) return;
    html += '<tr><th colspan="4">' + group.toUpperCase() + ' SETTINGS</th></tr>';
    for (let i = 0; i < fields.length; i += 2) {
      html += '<tr>' + presetFieldCell(group, fields[i], preset[group][fields[i].key]);
      html += fields[i + 1]
        ? presetFieldCell(group, fields[i + 1], preset[group][fields[i + 1].key])
        : '<td></td><td></td>';
      html += '</tr>';
    }
  });
  html += '</table>';
  el.innerHTML = html;
}

function selectedPresetIndex() {
  return parseInt($('presetSelect').value, 10);
}

// Wraps around at both ends (Prev from index 0 goes to the last preset,
// Next from the last goes back to 0) - matches the Sunton's own </> idx
// cycling behavior.
function selectPresetIndex(i) {
  if (parsedPresets.length === 0) return;
  const n = parsedPresets.length;
  const wrapped = ((i % n) + n) % n;
  $('presetSelect').value = wrapped;
  renderPresetPreview(parsedPresets[wrapped]);
}

// Rebuilds the <select>'s options from parsedPresets. Option values are
// just array indices, so ANY operation that changes the array's length
// (add/delete, not update) needs a full rebuild, not a single option
// add/remove - otherwise every option after the changed index would keep
// pointing at its old, now-wrong index.
function rebuildPresetSelect() {
  const sel = $('presetSelect');
  sel.innerHTML = '';
  parsedPresets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

function setPresetControlsEnabled(enabled) {
  $('presetSelect').disabled = !enabled;
  $('loadPresetBtn').disabled = !enabled;
  $('prevPresetBtn').disabled = !enabled;
  $('nextPresetBtn').disabled = !enabled;
  $('updatePresetBtn').disabled = !enabled;
  $('deletePresetBtn').disabled = !enabled;
  $('downloadSettingsBtn').disabled = !enabled;
}

$('settingsFile').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    parsedPresets = parseSettingsCsv(reader.result);
    rebuildPresetSelect();
    const ok = parsedPresets.length > 0;
    setPresetControlsEnabled(ok);
    $('presetStatus').textContent = ok
      ? (parsedPresets.length + ' preset(s) loaded from ' + file.name)
      : ('No presets found in ' + file.name + ' - check it\'s the right settings.csv format');
    renderPresetPreview(ok ? parsedPresets[0] : null);
  };
  reader.readAsText(file);
};

$('presetSelect').onchange = () => renderPresetPreview(parsedPresets[selectedPresetIndex()]);
$('prevPresetBtn').onclick = () => selectPresetIndex(selectedPresetIndex() - 1);
$('nextPresetBtn').onclick = () => selectPresetIndex(selectedPresetIndex() + 1);

$('loadPresetBtn').onclick = () => {
  const preset = parsedPresets[selectedPresetIndex()];
  if (!preset) return;
  const interlocked = latest && (latest.statusLEDs.arcOk || latest.statusLEDs.coolantOn || latest.inTHCCut || latest.inTestRun);
  const loadPreset = () => {
    if (send({ thc: preset.thc, movement: preset.movement, voltage: preset.voltage, sync: preset.sync })) {
      $('presetStatus').textContent = 'Sent "' + preset.name + '" - check the live values on the Settings tabs for the THC\'s own echo before cutting.';
    }
  };
  if (interlocked) {
    askConfirm('Arc, cut or test run is active on the THC. Load "' + preset.name + '" anyway?', 'Load anyway', loadPreset);
  } else {
    loadPreset();
  }
};

// Snapshots the THC's CURRENT LIVE settings from telemetry, in the same
// shape as a parsed preset (built generically off FIELDS so it can't drift
// out of sync with what parsePresetLine()/toDisplay() know about). Never
// captures testRun - same rule as loading.
function liveSettingsSnapshot() {
  if (!latest) return null;
  const snap = {};
  ['thc', 'movement', 'voltage', 'sync'].forEach((group) => {
    snap[group] = {};
    FIELDS[group].forEach((f) => {
      if (f.key === 'testRun') return;
      snap[group][f.key] = latest[group][f.key];
    });
  });
  return snap;
}

$('addPresetBtn').onclick = () => {
  const snap = liveSettingsSnapshot();
  if (!snap) { notify('Wait for at least one telemetry frame first.', true); return; }
  // Commas/newlines would corrupt the CSV row, so they can't be part of a name.
  const name = $('newPresetName').value.replace(/[,\r\n]+/g, ' ').trim();
  if (!name) { notify('Type a name for the new preset first.', true); $('newPresetName').focus(); return; }
  $('newPresetName').value = '';
  parsedPresets.push({ name, ...snap });
  rebuildPresetSelect();
  setPresetControlsEnabled(true);
  selectPresetIndex(parsedPresets.length - 1);
  $('presetStatus').textContent = 'Added "' + name + '" from the THC\'s current live settings (' +
    parsedPresets.length + ' preset(s) total) - use Save settings.csv to keep it.';
};

$('updatePresetBtn').onclick = () => {
  if (parsedPresets.length === 0) return;
  const snap = liveSettingsSnapshot();
  if (!snap) { notify('Wait for at least one telemetry frame first.', true); return; }
  const idx = selectedPresetIndex();
  const name = parsedPresets[idx].name;
  parsedPresets[idx] = { name, ...snap };
  renderPresetPreview(parsedPresets[idx]);
  $('presetStatus').textContent = 'Updated "' + name + '" from the THC\'s current live settings - use Save settings.csv to keep it.';
};

$('deletePresetBtn').onclick = () => {
  if (parsedPresets.length === 0) return;
  const idx = selectedPresetIndex();
  const name = parsedPresets[idx].name;
  askConfirm('Delete preset "' + name + '"? It is only removed from this list until you save settings.csv.', 'Delete', () => {
    parsedPresets.splice(idx, 1);
    rebuildPresetSelect();
    const ok = parsedPresets.length > 0;
    setPresetControlsEnabled(ok);
    if (ok) {
      selectPresetIndex(Math.min(idx, parsedPresets.length - 1));
    } else {
      renderPresetPreview(null);
    }
    $('presetStatus').textContent = 'Deleted "' + name + '" (' + parsedPresets.length +
      ' preset(s) remaining) - use Save settings.csv to keep the change.';
  });
};

// Reverse of parsePresetLine() - column order and every decimal precision
// below are copied verbatim from settingsLoader.h's writeCSVHeader()/
// writeSettingRow(), so a downloaded file can be dropped straight onto the
// Sunton's SD card as its settings.csv. testRun is always written "0" -
// it's never captured either direction. calibrationOffset intentionally
// uses truncating integer division (Math.trunc(raw/100)), matching that
// file's own asymmetric save-side behavior, not a bug to "fix" here.
const CSV_SETTINGS_HEADER = 'name,setpoint_voltage,tolerance,antidivePCT,voidSenseV,arcStabilizeDelay,pierceDelay,'
  + 'testCutTime,firstAvgDist,updownamt,delayStartEvent,THC_mode,steps_per_mm,testRun,'
  + 'exp,minVoltage,maxVoltage,minSpeed,maxSpeed,ultimateMax,tieMinToTolerance,'
  + 'multifactor,calibrationOffset,num_avg_reading,num_realtime_samples,expAlpha,'
  + 'displayUpdateInterval,displayUpdateModifier';

function fmtFixed(raw, divisor, decimals) {
  return (raw / divisor).toFixed(decimals);
}

function presetToCsvRow(p) {
  const stepsPerMm = p.thc.stepsPerMm || 200;
  const stepsToMm = 60.0 / stepsPerMm;
  const cols = [
    p.name,
    fmtFixed(p.thc.setpointVoltage, 100, 2),
    fmtFixed(p.thc.tolerance, 100, 2),
    fmtFixed(p.thc.antidivePct, 10, 1),
    fmtFixed(p.thc.voidSenseV, 100, 2),
    fmtFixed(p.thc.arcStabilizeDelay, 1000, 2),
    fmtFixed(p.thc.pierceDelay, 1000, 2),
    fmtFixed(p.thc.testCutTime, 1000, 2),
    String(p.thc.firstAvgDist),
    fmtFixed(p.thc.updownAmt, 10, 1),
    String(p.thc.delayStartEvent),
    String(p.thc.mode),
    String(stepsPerMm),
    '0',
    p.movement.exp.toFixed(3),
    fmtFixed(p.movement.minVoltage, 100, 2),
    fmtFixed(p.movement.maxVoltage, 100, 2),
    Math.round(p.movement.minSpeed * stepsToMm).toFixed(2),
    Math.round(p.movement.maxSpeed * stepsToMm).toFixed(2),
    Math.round(p.movement.ultimateMax * stepsToMm).toFixed(2),
    p.movement.tieMinToTolerance ? '1' : '0',
    fmtFixed(p.voltage.multifactor, 100, 3),
    String(Math.trunc(p.voltage.calibrationOffset / 100)),
    String(p.voltage.numAvgReading),
    String(p.voltage.numRealtimeSamples),
    fmtFixed(p.voltage.expAlpha, 1000, 2),
    String(p.sync.displayIntervalMs),
    String(p.sync.syncIntervalMs),
  ];
  return cols.join(',');
}

function buildSettingsCsv() {
  const lines = [CSV_SETTINGS_HEADER];
  parsedPresets.forEach((p) => lines.push(presetToCsvRow(p)));
  return lines.join('\n') + '\n';
}

$('downloadSettingsBtn').onclick = () => {
  if (parsedPresets.length === 0) { notify('No presets to save yet.', true); return; }
  exportText('settings.csv', 'settings.csv', buildSettingsCsv());
};

// ---- Workspace shell: Operate / Settings / Link ---------------------------
// Presentation + connection flow only; every control below the shell is the
// same logic as thc-panel.html.
let currentView = 'link';          // land on Link until a connection exists
let leaveLinkOnConnect = false;    // true only for a connect started from Link

function setView(view) {
  currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll('.nav button[data-view]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === view));
  });
  closeSetpointEdit();
  window.scrollTo(0, 0);
  // The window list can't scroll while its page is hidden, so pin it to the
  // newest window once Operate is showing again.
  if (view === 'operate') { const sc = $('avgScroll'); if (sc) sc.scrollTop = sc.scrollHeight; }
  if (view === 'link' && typeof diagSamples !== 'undefined') updateDiag();
}
document.querySelectorAll('.nav button[data-view]').forEach((b) => {
  b.onclick = () => { leaveLinkOnConnect = false; setView(b.dataset.view); };
});
$('offlineBar').onclick = () => setView('link');
$('disconnectBtn').onclick = () => {
  if (ws) { const old = ws; ws = null; old.close(); }
  setStatus('disconnected', false);
};
$('host').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });

// Remembered address (and theme) come from the dashboard.
initDashboardBridge();

// ---- Diagnostics ---------------------------------------------------------
function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + sec + 's';
}
// Frame rate is measured over a sliding ~1.5 s window of (time, frameCount)
// samples rather than "since the last tick", so it stays steady however
// fast the diagnostics refresh itself runs.
const diagSamples = [];
function updateDiag() {
  const now = performance.now();
  diagSamples.push({ t: now, n: frameCount });
  while (diagSamples.length > 2 && now - diagSamples[0].t > 1500) diagSamples.shift();
  const first = diagSamples[0], last = diagSamples[diagSamples.length - 1];
  const span = (last.t - first.t) / 1000;
  const fps = span >= 0.2 ? (last.n - first.n) / span : 0;

  $('dFrames').textContent = String(frameCount);
  $('dGaps').textContent = String(gapCount);
  $('dFps').textContent = linkState === 'connected' ? fps.toFixed(0) + ' / s' : '--';
  $('dAge').textContent = lastFrameAt ? Math.round(now - lastFrameAt) + ' ms ago' : '--';
  $('dUptime').textContent = (latest && latest.t != null) ? fmtUptime(latest.t) : '--';
  const syncMs = latest && latest.sync ? latest.sync.syncIntervalMs : null;
  $('dSync').textContent = syncMs != null ? syncMs + ' ms' : '--';

  // Advisory only. From a measured cut log: telemetry frames are built on
  // the same core as the control loop, and a 15 ms interval visibly
  // stretched loop timing (6 ms -> 9-12 ms on a quarter of iterations).
  const warn = $('diagWarn');
  if (syncMs != null && syncMs < 25) {
    warn.hidden = false;
    warn.textContent = 'Sync interval is ' + syncMs + ' ms - faster than the display needs. Each telemetry frame is built on the same core as the torch-height loop; 50 ms or more is plenty for readouts.';
  } else {
    warn.hidden = true;
  }
}

// Refresh rate follows the THC's display interval (the same setting that
// throttles the stat tiles), clamped to 50 ms..1 s so a 0 or huge value
// can't spin or freeze it. It used to be a fixed 500 ms, which is why
// changing the display rate never made this page update any faster. The
// banner check runs every tick on every page; the heavier diagnostics only
// while the Link page is actually showing.
function diagTick() {
  updateOfflineBar();
  if (currentView === 'link') updateDiag();
  const d = latest && latest.sync ? latest.sync.displayIntervalMs : 0;
  setTimeout(diagTick, Math.max(50, Math.min(1000, d || 250)));
}
diagTick();

setView('link');
setStatus('disconnected', false);
