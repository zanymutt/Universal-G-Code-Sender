(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const Core = window.NestCore;

  const numbers = ['count', 'sizeX', 'sizeY', 'gap', 'rotStep', 'originX', 'originY', 'rapid'];
  const choices = ['mode', 'effort', 'prefer', 'origin', 'order', 'cutOrder'];
  const checks = ['rotate', 'tags'];
  const solverFields = ['mode', 'count', 'sizeX', 'sizeY', 'gap', 'rotate', 'rotStep', 'effort', 'prefer'];
  const outputFields = ['origin', 'originX', 'originY', 'order', 'cutOrder', 'tags', 'rapid'];
  const allFields = [...numbers, ...choices, ...checks];
  const MAX_INPUT_CHARS = 3000000;
  const MAX_OUTPUT_CHARS = 40000000;
  const PREVIEW_CHARS = 1500000;
  // Embedded copy of sample.gcode. The plugin runs sandboxed (opaque origin), so it cannot fetch its own files.
  const SAMPLE = ["(Sample plasma part for the Nesting plugin: 40 x 30 mm triangle with a lead-in)","(Structure mirrors a typical GRBL plasma post: setup, torch height probe, pierce, cut, retract, end)","G90 G94 G17","G21","G54","","G0 X10 Y-6 F2500","G0 X10 Y-6 Z25","","G53 G38.2 Z0 F200","(Read float switch input immediately after probe stop)","M66 P0 L0","#100 = -3 ; default assume float switch trigger","o100 if [#5399 EQ 0]","  #100 = -0.2 ; float inactive, assume ohmic trigger","o100 endif","G10 L20 Z[#100]","G0 X10 Y-6  ; force position after probe","Z3","M4 S1000","G4 P0.4","G1 Z2.5 F2500","M8","G1 X10 Y0","X40 Y0","X20 Y30","X0 Y0","X10 Y0","X10 Y-6","M5","G4 p0.5","M9","G0 Z30","G0 Z40","","M5","G0 X0 Y0","M30"].join('\n') + '\n';

  const MODES = {
    fixedX: { count: true, x: 'Maximum X (mm)', y: null, hint: 'Fills rows within the maximum X and grows in Y. The frame reported is what is actually used, so it can be narrower than the maximum.' },
    fixedY: { count: true, x: null, y: 'Maximum Y (mm)', hint: 'Fills columns within the maximum Y and grows in X. The frame reported is what is actually used, so it can be shorter than the maximum.' },
    minArea: { count: true, x: 'X limit (mm, optional)', y: 'Y limit (mm, optional)', hint: 'Tries many widths and keeps the smallest bounding rectangle. Without limits this is often a long narrow strip; set an X or Y limit to keep it practical.' },
    maxParts: { count: false, x: 'Sheet X (mm)', y: 'Sheet Y (mm)', hint: 'Places as many copies as fit on the sheet. Tries both directions and keeps the better result.' },
  };

  // ---------------------------------------------------------------- tabs
  const tabs = [...document.querySelectorAll('[role=tab]')];
  function showTab(tab) {
    tabs.forEach(t => {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !active;
    });
    window.Dropdowns?.refresh();
  }
  tabs.forEach((tab, i) => {
    tab.onclick = () => showTab(tab);
    tab.onkeydown = e => {
      let index;
      if (e.key === 'ArrowRight') index = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') index = (i + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') index = 0;
      else if (e.key === 'End') index = tabs.length - 1;
      else return;
      e.preventDefault();
      showTab(tabs[index]);
      tabs[index].focus({ preventScroll: true });
    };
  });

  // ---------------------------------------------------------------- state
  let src = null, srcName = '', layout = null, built = null, geo = null, code = '', codeTruncated = false;
  let running = false, ctl = null, picking = false, savePending = false, revision = 0;

  function settings() {
    const o = {};
    numbers.forEach(k => { o[k] = $(k).value.trim() === '' ? NaN : Number($(k).value); });
    choices.forEach(k => { o[k] = $(k).value; });
    checks.forEach(k => { o[k] = $(k).checked; });
    return o;
  }
  function message(text, error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
  }
  const fmt = (v, d = 1) => Number(v.toFixed(d)).toString();
  function duration(sec) {
    if (!(sec >= 0)) return '?';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
    return h ? `${h} h ${m} min` : m ? `${m} min ${s} s` : `${s} s`;
  }
  function setPick(value) {
    picking = value;
    $('preview').classList.toggle('picking', value);
  }
  function invalidate() {
    setPick(false);
    revision++;
    layout = null; built = null; geo = null; code = ''; codeTruncated = false;
    $('output').value = '';
    $('save').disabled = true;
    $('copy').disabled = true;
    $('pickOrigin').disabled = true;
  }
  function updateModeFields() {
    const ui = MODES[$('mode').value];
    $('countWrap').hidden = !ui.count;
    $('sizeXWrap').hidden = !ui.x;
    $('sizeYWrap').hidden = !ui.y;
    if (ui.x) $('sizeXLabel').textContent = ui.x;
    if (ui.y) $('sizeYLabel').textContent = ui.y;
    $('modeHint').textContent = ui.hint;
    $('rotStep').disabled = !$('rotate').checked;
    const custom = $('origin').value === 'custom';
    $('originX').disabled = !custom;
    $('originY').disabled = !custom;
    window.Dropdowns?.refresh();
  }

  // ---------------------------------------------------------------- loading a part
  function partInfoText() {
    const s = src, mm = s.mmPerUnit;
    const a = Core.analyze(s.lines.join('\n'), { rapid: settings().rapid });
    const w = (s.bbox.maxX - s.bbox.minX) * mm, h = (s.bbox.maxY - s.bbox.minY) * mm;
    const tops = s.contours.filter(c => c.top).length;
    return [
      srcName || 'G-code part',
      `${s.lines.length} lines: ${s.bodyStart} header · ${s.bodyEnd - s.bodyStart} repeated per part · ${s.lines.length - s.bodyEnd} footer`,
      `Outline ${fmt(w, 2)} × ${fmt(h, 2)} mm (${s.unit === 'in' ? 'file is in inches' : 'file is in mm'})`,
      `${s.contours.length} cut path${s.contours.length === 1 ? '' : 's'}: ${tops} outer, ${s.contours.length - tops} inner`,
      `${s.blocks.length} cut cycle${s.blocks.length === 1 ? '' : 's'}: ${s.blocks.filter(b => b.internal).length} inner, ${s.blocks.filter(b => !b.internal).length} outer${s.blocks.length > 1 ? ' (can be reordered)' : ''}`,
      `One part: cut ${fmt(a.cutMM / 1000, 2)} m${a.pierces ? ` · ${a.pierces} pierce${a.pierces === 1 ? '' : 's'}` : ''} · ≈ ${duration(a.seconds)}`,
    ].join('\n');
  }
  function loadText(text, name) {
    invalidate();
    if (text.length > MAX_INPUT_CHARS) {
      src = null;
      message(`That file is ${fmt(text.length / 1e6, 1)} MB; this plugin repeats it once per part, so it is limited to ${MAX_INPUT_CHARS / 1e6} MB.`, true);
      afterLoad();
      return;
    }
    try {
      src = Core.extract(text);
      srcName = name || '';
    } catch (e) {
      src = null;
      $('partInfo').textContent = 'Could not read this file.';
      message(e.message, true);
      afterLoad();
      return;
    }
    $('partInfo').textContent = partInfoText();
    const warn = $('partWarnings');
    warn.hidden = !src.warnings.length;
    warn.textContent = src.warnings.join('\n');
    viewBox = null;
    afterLoad();
    message(`Loaded ${srcName || 'part'}. Pick a layout, then click Nest & generate. Nothing is sent to the machine.`);
  }
  function afterLoad() {
    $('nest').disabled = !src || running;
    if (!src) { $('partWarnings').hidden = true; }
    viewBox = null;
    draw();
  }

  // ---------------------------------------------------------------- nesting
  async function runNest() {
    if (!src || running) return;
    const o = settings();
    running = true;
    ctl = { cancelled: false };
    invalidate();
    $('nest').disabled = true;
    $('stop').hidden = false;
    $('progress').textContent = 'Nesting…';
    message('Nesting…');
    draw();
    const started = Date.now();
    try {
      const gen = Core.nestGen(src, {
        mode: o.mode, count: o.count, sizeX: o.sizeX, sizeY: o.sizeY, gap: o.gap,
        rotate: o.rotate, rotStep: o.rotStep, effort: o.effort, prefer: o.prefer,
      }, ctl);
      let step;
      while (!(step = gen.next()).done) {
        $('progress').textContent = `Nesting… ${step.value.placed} placed · ${((Date.now() - started) / 1000).toFixed(1)} s`;
        await new Promise(r => setTimeout(r, 0));
      }
      layout = step.value;
      viewBox = null;
      regenerate();
      const v = layout.verify;
      let text = `Placed ${layout.count} part${layout.count === 1 ? '' : 's'} in ${fmt(layout.frame.w, 1)} × ${fmt(layout.frame.h, 1)} mm, ${fmt(layout.utilization * 100, 0)}% of the frame used. `
        + (layout.count > 1 ? `Smallest gap ${Number.isFinite(v.minGap) ? fmt(v.minGap, 2) : '> ' + fmt(o.gap + 2, 1)} mm (asked ≥ ${fmt(o.gap, 2)}). ` : '')
        + `(${((Date.now() - started) / 1000).toFixed(1)} s)`;
      if (!v.ok) text += '\nWARNING: the exact check found parts closer than the gap or outside the frame. Do not run this; report it.';
      if (o.mode !== 'maxParts' && layout.count < o.count) text += `\nOnly ${layout.count} of ${o.count} parts fit.`;
      message(text + '\nInspect the preview and the machine Z reference before running. Nothing has been sent.', !v.ok);
    } catch (e) {
      invalidate();
      message(e.message, true);
      draw();
    } finally {
      running = false;
      ctl = null;
      $('nest').disabled = !src;
      $('stop').hidden = true;
      $('progress').textContent = '';
    }
  }

  function regenerate() {
    if (!src || !layout) return;
    const o = settings();
    const opts = { origin: o.origin, custom: { x: o.originX, y: o.originY }, order: o.order, cutOrder: o.cutOrder, tags: o.tags, gap: o.gap, name: srcName };
    let bodyChars = 0;
    for (let i = src.bodyStart; i < src.bodyEnd; i++) bodyChars += src.lines[i].length + 8;
    if (bodyChars * layout.count > MAX_OUTPUT_CHARS) throw Error(`The nested program would be over ${MAX_OUTPUT_CHARS / 1e6} MB (${layout.count} copies of a ${fmt(bodyChars / 1000, 0)} KB part). Reduce the part count.`);
    built = Core.buildGcode(src, layout, opts);
    geo = Core.previewGeometry(src, layout, opts);
    code = built.text;
    codeTruncated = code.length > PREVIEW_CHARS;
    $('output').value = codeTruncated ? code.slice(0, PREVIEW_CHARS) + '\n… preview truncated; Save As uses the full program.' : code;
    $('save').disabled = window.parent === window || savePending;
    $('copy').disabled = false;
    $('pickOrigin').disabled = false;
    const est = Core.analyze(code, { rapid: o.rapid });
    const v = layout.verify;
    $('summary').textContent = `${layout.count} parts · frame ${fmt(layout.frame.w, 1)} × ${fmt(layout.frame.h, 1)} mm · ${fmt(layout.utilization * 100, 0)}% used`
      + (layout.count > 1 && Number.isFinite(v.minGap) ? ` · min gap ${fmt(v.minGap, 2)} mm` : '')
      + ` · cut ${fmt(est.cutMM / 1000, 2)} m · travel ${fmt(est.rapidMM / 1000, 2)} m · ≈ ${duration(est.seconds)}`
      + (est.unknownFeed ? ` · ${est.unknownFeed} cut move(s) without a feed rate` : '');
    draw();
  }

  // ---------------------------------------------------------------- preview
  let fitBox = null, viewBox = null;
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.append(n);
    return n;
  };
  const pointList = pts => pts.map(p => `${p.x},${-p.y}`).join(' ');
  function applyView() {
    if (viewBox) $('preview').setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    $('zoomLevel').textContent = fitBox && viewBox ? Math.round(fitBox.w / viewBox.w * 100) + '%' : '100%';
  }
  function fit(points) {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of points) {
      b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
      b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
    }
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1), pad = size * 0.08;
    fitBox = { x: b.minX - pad, y: -b.maxY - pad, w: Math.max(b.maxX - b.minX, 1) + 2 * pad, h: Math.max(b.maxY - b.minY, 1) + 2 * pad };
    if (!viewBox) viewBox = { ...fitBox };
    applyView();
    return size;
  }
  function draw() {
    window.Dropdowns?.refresh();
    const svg = $('preview');
    svg.replaceChildren();
    if (!src) {
      $('summary').textContent = 'Load a part to begin.';
      el('text', { x: 50, y: 50, 'text-anchor': 'middle', 'font-size': 5 }, svg).textContent = 'Load a part to preview';
      return;
    }
    if (!layout || !geo || !built) { drawPart(svg); return; }

    const a = built.anchor, f = layout.frame;
    const frame = [{ x: -a.x, y: -a.y }, { x: f.w - a.x, y: f.h - a.y }];
    const size = fit([...frame, { x: 0, y: 0 }]);
    const partSize = Math.max(src.bbox.maxX - src.bbox.minX, src.bbox.maxY - src.bbox.minY) * src.mmPerUnit;
    const font = Math.max(partSize * 0.09, size * 0.012);
    el('rect', { x: frame[0].x, y: -frame[1].y, width: f.w, height: f.h, fill: 'none', stroke: '#718196', 'stroke-width': 1, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, svg);
    // Travel: work zero -> first cut -> ... -> last cut -> work zero (the program's park move).
    let prev = { x: 0, y: 0 };
    const travel = el('g', {}, svg);
    const dash = (from, to) => el('line', { x1: from.x, y1: -from.y, x2: to.x, y2: -to.y, stroke: '#ffbf69', 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.6, 'vector-effect': 'non-scaling-stroke' }, travel);
    for (const item of geo.sequence) { dash(prev, item.start); prev = item.end; }
    dash(prev, { x: 0, y: 0 });
    for (const p of geo.parts) {
      const g = el('g', { 'data-part': p.index + 1 }, svg);
      for (const c of p.contours) {
        if (c.top) {
          el('polygon', { points: pointList(c.pts), fill: 'rgba(145,207,158,.14)', stroke: '#91cf9e', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, g);
        } else {
          el('polyline', { points: pointList(c.pts), fill: 'none', stroke: '#5f8a69', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, g);
        }
      }
    }
    for (const item of geo.sequence) {
      const g = el('g', { 'data-cut': item.seq }, svg);
      el('circle', { cx: item.start.x, cy: -item.start.y, r: size * 0.005, fill: '#ffbf69' }, g);
      const t = el('text', { x: item.start.x + font * 0.35, y: -item.start.y - font * 0.5, 'font-size': font, 'pointer-events': 'none' }, g);
      t.textContent = String(item.seq);
      const part = geo.parts[item.part];
      el('title', {}, g).textContent = `Cut ${item.seq} · part ${item.part + 1} · ${src.blocks.length > 1 ? (item.internal ? 'inner' : 'outer') + ' cut · ' : ''}rotated ${fmt(part.angle, 2)}°`;
    }
    el('path', { d: `M ${-size * 0.02} 0 H ${size * 0.02} M 0 ${-size * 0.02} V ${size * 0.02}`, stroke: '#ff7272', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, svg);
  }
  function drawPart(svg) {
    const s = src.mmPerUnit;
    const map = p => ({ x: (p.x - src.center.x) * s, y: (p.y - src.center.y) * s });
    const all = src.contours.flatMap(c => c.pts.map(map));
    const size = fit(all);
    for (const c of src.contours) {
      const pts = c.pts.map(map);
      if (c.top) el('polygon', { points: pointList(pts), fill: 'rgba(145,207,158,.14)', stroke: '#91cf9e', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, svg);
      else el('polyline', { points: pointList(pts), fill: 'none', stroke: '#5f8a69', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, svg);
    }
    const first = map(src.firstPoint);
    el('circle', { cx: first.x, cy: -first.y, r: size * 0.008, fill: '#ffbf69' }, svg);
    const w = (src.bbox.maxX - src.bbox.minX) * s, h = (src.bbox.maxY - src.bbox.minY) * s;
    $('summary').textContent = `Part: ${fmt(w, 2)} × ${fmt(h, 2)} mm · ${src.contours.length} cut path${src.contours.length === 1 ? '' : 's'} · not nested yet`;
  }

  // ---------------------------------------------------------------- zoom / pan / picking
  function zoom(factor, anchor) {
    if (!fitBox || !viewBox) return;
    const scale = Math.max(1, Math.min(32, fitBox.w / viewBox.w * factor));
    const w = fitBox.w / scale, h = fitBox.h / scale;
    const q = anchor || { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
    viewBox = { x: q.x - (q.x - viewBox.x) * w / viewBox.w, y: q.y - (q.y - viewBox.y) * h / viewBox.h, w, h };
    applyView();
  }
  $('zoomIn').onclick = () => zoom(1.4);
  $('zoomOut').onclick = () => zoom(1 / 1.4);
  $('zoomFit').onclick = () => { if (fitBox) { viewBox = { ...fitBox }; applyView(); } };
  $('preview').setAttribute('tabindex', '-1');
  $('preview').addEventListener('wheel', event => {
    if (!src) return;
    event.preventDefault();
    const m = $('preview').getScreenCTM();
    if (!m) return;
    zoom(Math.exp(-event.deltaY * 0.002), new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse()));
  }, { passive: false });
  let pan = null, suppressClick = false;
  $('preview').addEventListener('pointerdown', event => {
    suppressClick = false;
    if (!src || picking || event.button !== 0) return;
    const m = $('preview').getScreenCTM();
    if (!m) return;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, box: { ...viewBox }, inverse: m.inverse() };
    $('preview').setPointerCapture(event.pointerId);
  });
  $('preview').addEventListener('pointermove', event => {
    if (!pan || pan.id !== event.pointerId) return;
    const from = new DOMPoint(pan.x, pan.y).matrixTransform(pan.inverse);
    const to = new DOMPoint(event.clientX, event.clientY).matrixTransform(pan.inverse);
    if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 3) suppressClick = true;
    viewBox = { ...pan.box, x: pan.box.x + from.x - to.x, y: pan.box.y + from.y - to.y };
    applyView();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('preview').addEventListener(ev, () => { pan = null; });
  $('pickOrigin').onclick = () => {
    if (!layout) return;
    setPick(true);
    message('Tap the preview to place the origin (work X0 Y0).');
    $('preview').focus({ preventScroll: true });
  };
  $('preview').addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; return; }
    if (!picking || !layout || !built) return;
    const m = $('preview').getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse());
    // Preview is drawn in output coordinates; custom origin is measured from the frame's bottom-left.
    $('origin').value = 'custom';
    $('originX').value = (p.x + built.anchor.x).toFixed(3);
    $('originY').value = (-p.y + built.anchor.y).toFixed(3);
    $('origin').dispatchEvent(new Event('input', { bubbles: true }));
    setPick(false);
    message('Origin moved. Machine zero is unchanged; zero the torch at the same point on the sheet.');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && picking) { setPick(false); message('Origin picking canceled.'); }
  });

  const divider = $('divider');
  let resizing = false, split = 55;
  function setSplit(value) {
    split = Math.max(25, Math.min(75, value));
    $('work').style.setProperty('--split', split + '%');
    divider.setAttribute('aria-valuenow', Math.round(split));
  }
  divider.addEventListener('pointerdown', event => { if (event.button !== 0) return; resizing = true; divider.setPointerCapture(event.pointerId); event.preventDefault(); });
  divider.addEventListener('pointermove', event => { if (!resizing) return; const r = $('work').getBoundingClientRect(); setSplit((event.clientX - r.left) / r.width * 100); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) divider.addEventListener(ev, () => { resizing = false; });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setSplit(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : split + (event.key === 'ArrowLeft' ? -2 : 2));
  });
  divider.ondblclick = () => setSplit(55);

  // ---------------------------------------------------------------- inputs
  solverFields.forEach(id => $(id).addEventListener('input', () => {
    updateModeFields();
    if (layout) { invalidate(); viewBox = null; draw(); message('Settings changed. Click Nest & generate.'); }
    saveLastSoon();
  }));
  outputFields.forEach(id => $(id).addEventListener('input', () => {
    updateModeFields();
    if (id === 'rapid' && src) $('partInfo').textContent = partInfoText();
    if (layout) {
      try { regenerate(); } catch (e) { message(e.message, true); }
    }
    saveLastSoon();
  }));
  $('nest').onclick = runNest;
  $('stop').onclick = () => { if (ctl) ctl.cancelled = true; };

  $('file').addEventListener('change', async () => {
    const file = $('file').files[0];
    if (!file) return;
    try {
      if (file.size > MAX_INPUT_CHARS) throw Error(`That file is ${fmt(file.size / 1e6, 1)} MB; the limit is ${MAX_INPUT_CHARS / 1e6} MB.`);
      loadText(await file.text(), file.name);
    } catch (e) {
      message(e.message, true);
    }
  });
  $('example').onclick = () => {
    $('file').value = '';
    loadText(SAMPLE, 'Example: 40 x 30 mm triangle');
  };

  // ---------------------------------------------------------------- Dashboard bridge
  let requestId = 0;
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'fluid-response') return;
    const p = pending.get(event.data.id);
    if (!p) return;
    pending.delete(event.data.id);
    event.data.error ? p.reject(Error(event.data.error)) : p.resolve(event.data.result);
  });
  function host(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ type: 'fluid-request', id, method, params }, '*');
    });
  }
  async function loadOpenFile(announce) {
    try {
      const text = await host('getGcode');
      if (!text || !String(text).trim()) {
        if (announce) message('No G-code file is open in the Dashboard. Choose a file from this device instead.', true);
        return;
      }
      let name = 'File open in Dashboard';
      try {
        const status = await host('getFileStatus');
        if (status?.fileName) name = status.fileName.split(/[\\/]/).pop();
      } catch { /* the name is cosmetic */ }
      $('file').value = '';
      loadText(String(text), name);
    } catch (e) {
      if (announce) message('Could not read the open file: ' + e.message, true);
    }
  }
  $('useOpen').onclick = () => loadOpenFile(true);

  $('save').onclick = async () => {
    if (!code || savePending) return;
    savePending = true;
    $('save').disabled = true;
    const generation = revision;
    try {
      await host('saveGcodeAs', { content: code });
      message('Saved and opened in Dashboard. The machine has not been started.');
    } catch (e) {
      message(e.message, true);
    } finally {
      savePending = false;
      $('save').disabled = !code || generation !== revision || window.parent === window;
    }
  };
  $('copy').onclick = async () => {
    if (codeTruncated) {
      try { await navigator.clipboard.writeText(code); message('G-code copied.'); }
      catch { message('The program is too large to copy from here. Use Save As into Dashboard.', true); }
      return;
    }
    $('output').focus();
    $('output').select();
    try {
      if (!document.execCommand('copy')) throw Error();
      message('G-code copied.');
    } catch {
      message('G-code selected. Use your device’s Copy command.');
    }
  };

  // ---------------------------------------------------------------- presets and remembered settings
  let stored = {}, presets = [], saveTimer = null;
  function values() {
    const v = {};
    allFields.forEach(k => { v[k] = $(k).type === 'checkbox' ? $(k).checked : $(k).value; });
    return v;
  }
  function apply(v) {
    allFields.forEach(k => {
      if (!Object.hasOwn(v, k)) return;
      if ($(k).type === 'checkbox') $(k).checked = !!v[k]; else $(k).value = v[k];
    });
    updateModeFields();
  }
  async function persist(patch) {
    const data = { ...stored, ...patch };
    await host('saveSettings', { data });
    stored = data;
  }
  function saveLastSoon() {
    if (window.parent === window) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persist({ nestLast: values() }).catch(() => {}); }, 600);
  }
  function presetList() {
    $('presets').replaceChildren(new Option('Choose a preset', ''));
    presets.forEach((p, i) => $('presets').append(new Option(p.name, String(i))));
  }
  $('savePreset').onclick = async () => {
    const name = $('presetName').value.trim();
    if (!name) { message('Enter a preset name.', true); return; }
    $('savePreset').disabled = true;
    try {
      const next = presets.filter(p => p.name !== name);
      next.push({ name, values: values() });
      await persist({ nestPresets: next });
      presets = next;
      presetList();
      message('Preset saved: ' + name);
    } catch (e) { message('Could not save preset: ' + e.message, true); }
    finally { $('savePreset').disabled = false; }
  };
  $('loadPreset').onclick = () => {
    const preset = presets[Number($('presets').value)];
    if ($('presets').value === '' || !preset) return;
    apply(preset.values);
    $('presetName').value = preset.name;
    if (layout) { invalidate(); viewBox = null; draw(); }
    message('Loaded preset: ' + preset.name + '. Click Nest & generate.');
    saveLastSoon();
  };
  $('deletePreset').onclick = async () => {
    if ($('presets').value === '') return;
    const index = Number($('presets').value);
    $('deletePreset').disabled = true;
    try {
      const next = presets.filter((_, i) => i !== index);
      await persist({ nestPresets: next });
      presets = next;
      presetList();
      message('Preset deleted.');
    } catch (e) { message(e.message, true); }
    finally { $('deletePreset').disabled = false; }
  };

  updateModeFields();
  draw();
  if (window.parent !== window) {
    host('getSettings').then(data => {
      stored = data && typeof data === 'object' ? data : {};
      presets = Array.isArray(stored.nestPresets) ? stored.nestPresets.filter(p => typeof p.name === 'string' && p.values && typeof p.values === 'object') : [];
      presetList();
      $('savePreset').disabled = false;
      if (stored.nestLast && typeof stored.nestLast === 'object') apply(stored.nestLast);
    }).catch(e => message('Could not load saved settings: ' + e.message, true))
      .finally(() => loadOpenFile(false));
  } else {
    $('useOpen').disabled = true;
  }
})();
