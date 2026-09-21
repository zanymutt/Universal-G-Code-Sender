(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const Core = window.NestCore;

  const numbers = ['sizeX', 'sizeY', 'gap', 'rotStep', 'originX', 'originY', 'rapid'];
  const choices = ['mode', 'effort', 'prefer', 'origin', 'order', 'cutOrder'];
  const checks = ['rotate', 'tags'];
  const solverFields = ['mode', 'sizeX', 'sizeY', 'gap', 'rotate', 'rotStep', 'effort', 'prefer'];
  const outputFields = ['origin', 'originX', 'originY', 'order', 'cutOrder', 'tags', 'rapid'];
  const allFields = [...numbers, ...choices, ...checks];
  const MAX_INPUT_CHARS = 3000000;
  const MAX_OUTPUT_CHARS = 40000000;
  const PREVIEW_CHARS = 1500000;
  // Embedded copy of sample.gcode. The plugin runs sandboxed (opaque origin), so it cannot fetch its own files.
  const SAMPLE = ["(Sample plasma part for the Nesting plugin: 40 x 30 mm triangle with a lead-in)","(Structure mirrors a typical GRBL plasma post: setup, torch height probe, pierce, cut, retract, end)","G90 G94 G17","G21","G54","","G0 X10 Y-6 F2500","G0 X10 Y-6 Z25","","G53 G38.2 Z0 F200","(Read float switch input immediately after probe stop)","M66 P0 L0","#100 = -3 ; default assume float switch trigger","o100 if [#5399 EQ 0]","  #100 = -0.2 ; float inactive, assume ohmic trigger","o100 endif","G10 L20 Z[#100]","G0 X10 Y-6  ; force position after probe","Z3","M4 S1000","G4 P0.4","G1 Z2.5 F2500","M8","G1 X10 Y0","X40 Y0","X20 Y30","X0 Y0","X10 Y0","X10 Y-6","M5","G4 p0.5","M9","G0 Z30","G0 Z40","","M5","G0 X0 Y0","M30"].join('\n') + '\n';

  const MODES = {
    fixedX: { x: 'Maximum X (mm)', y: null, hint: 'Places the requested copies in rows within the maximum X and grows in Y. The frame reported is what is actually used.' },
    fixedY: { x: null, y: 'Maximum Y (mm)', hint: 'Places the requested copies in columns within the maximum Y and grows in X. The frame reported is what is actually used.' },
    minArea: { x: 'X limit (mm, optional)', y: 'Y limit (mm, optional)', hint: 'Tries many widths and keeps the smallest bounding rectangle for all requested copies. Set an X or Y limit to keep it practical.' },
    maxParts: { x: 'Sheet X (mm)', y: 'Sheet Y (mm)', hint: 'Fits every requested copy on the sheet. Tries both directions and keeps the better result.' },
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
  let entries = [], layout = null, built = null, geo = null, code = '', codeTruncated = false;
  let nextEntryId = 1;
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

  // ---------------------------------------------------------------- loading files
  function entryInfo(entry) {
    const s = entry.src, mm = s.mmPerUnit;
    const a = Core.analyze(s.lines.join('\n'), { rapid: settings().rapid });
    const w = (s.bbox.maxX - s.bbox.minX) * mm, h = (s.bbox.maxY - s.bbox.minY) * mm;
    const tops = s.contours.filter(c => c.top).length;
    return `${fmt(w, 2)} × ${fmt(h, 2)} mm · ${s.blocks.length} cut cycle${s.blocks.length === 1 ? '' : 's'} · ${tops} outer · ${entry.copies} copie${entry.copies === 1 ? '' : 's'} · ≈ ${duration(a.seconds * entry.copies)}`;
  }
  function refreshFileList() {
    const list = $('fileList');
    list.replaceChildren();
    if (!entries.length) {
      list.innerHTML = '<p class="hint">Add one or more G-code files. Set the copy count for each file below.</p>';
    } else entries.forEach(entry => {
      const row = document.createElement('div'); row.className = 'fileItem'; row.dataset.id = entry.id;
      const head = document.createElement('div'); head.className = 'fileItemHeader';
      const name = document.createElement('div'); name.className = 'fileItemName'; name.textContent = entry.name || 'G-code file';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'fileItemRemove'; remove.setAttribute('aria-label', `Remove ${entry.name || 'file'}`); remove.textContent = '×';
      remove.onclick = () => { entries = entries.filter(item => item.id !== entry.id); invalidate(); refreshFiles(); message(entries.length ? 'File removed. Nest & generate to update the output.' : 'Add a G-code file to begin.'); };
      head.append(name, remove); row.append(head);
      const meta = document.createElement('div'); meta.className = 'fileItemMeta'; meta.textContent = entryInfo(entry); row.append(meta);
      const copies = document.createElement('label'); copies.className = 'fileItemCopies'; copies.textContent = 'Copies';
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '2000'; input.step = '1'; input.value = String(entry.copies); input.setAttribute('aria-label', `Copies of ${entry.name || 'file'}`);
      input.oninput = () => { entry.copies = Math.max(1, Math.min(2000, Math.floor(Number(input.value) || 1))); input.value = String(entry.copies); meta.textContent = entryInfo(entry); updateFileSummary(); saveLastSoon(); };
      copies.append(input); row.append(copies); list.append(row);
    });
    updateFileSummary();
  }
  function updateFileSummary() {
    const total = entries.reduce((sum, entry) => sum + entry.copies, 0);
    $('partInfo').textContent = entries.length ? `${entries.length} file${entries.length === 1 ? '' : 's'} · ${total} requested cop${total === 1 ? 'y' : 'ies'}\n${entries.map(entry => `${entry.name || 'G-code file'} · ${entry.copies} cop${entry.copies === 1 ? 'y' : 'ies'}`).join('\n')}` : 'Add a G-code file in the Files tab. Each file is treated as one complete part.';
    const warnings = entries.flatMap(entry => entry.src.warnings.map(w => `${entry.name}: ${w}`));
    $('fileWarnings').hidden = !warnings.length;
    $('fileWarnings').textContent = warnings.join('\n');
  }
  function refreshFiles() {
    $('nest').disabled = !entries.length || running;
    refreshFileList();
    viewBox = null;
    draw();
  }
  function addText(text, name) {
    if (text.length > MAX_INPUT_CHARS) throw Error(`${name || 'That file'} is ${fmt(text.length / 1e6, 1)} MB; the limit is ${MAX_INPUT_CHARS / 1e6} MB.`);
    const src = Core.extract(text);
    entries.push({ id: nextEntryId++, name: name || 'G-code file', text, src, copies: 1 });
  }

  // ---------------------------------------------------------------- nesting
  async function runNest() {
    if (!entries.length || running) return;
    if (new Set(entries.map(entry => entry.src.unit)).size > 1) { message('All files must use the same G-code units (all mm or all inches).', true); return; }
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
      const gen = Core.nestGen(entries.map(entry => entry.src), {
        mode: o.mode, counts: entries.map(entry => entry.copies), sizeX: o.sizeX, sizeY: o.sizeY, gap: o.gap, origin: o.origin,
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
      let text = `Placed ${layout.count} part${layout.count === 1 ? '' : 's'} from ${entries.length} file${entries.length === 1 ? '' : 's'} in ${fmt(layout.frame.w, 1)} × ${fmt(layout.frame.h, 1)} mm, ${fmt(layout.utilization * 100, 0)}% of the frame used. `
        + (layout.count > 1 ? `Smallest gap ${Number.isFinite(v.minGap) ? fmt(v.minGap, 2) : '> ' + fmt(o.gap + 2, 1)} mm (asked ≥ ${fmt(o.gap, 2)}). ` : '')
        + `(${((Date.now() - started) / 1000).toFixed(1)} s)`;
      if (!v.ok) text += '\nWARNING: the exact check found parts closer than the gap or outside the frame. Do not run this; report it.';
      message(text + '\nInspect the preview and the machine Z reference before running. Nothing has been sent.', !v.ok);
    } catch (e) {
      invalidate();
      message(e.message, true);
      draw();
    } finally {
      running = false;
      ctl = null;
      $('nest').disabled = !entries.length;
      $('stop').hidden = true;
      $('progress').textContent = '';
    }
  }

  function regenerate() {
    if (!entries.length || !layout) return;
    const o = settings();
    const opts = { origin: o.origin, custom: { x: o.originX, y: o.originY }, order: o.order, cutOrder: o.cutOrder, tags: o.tags, gap: o.gap, names: entries.map(entry => entry.name) };
    const bodyChars = entries.reduce((sum, entry) => sum + entry.copies * entry.src.lines.slice(entry.src.bodyStart, entry.src.bodyEnd).reduce((n, line) => n + line.length + 8, 0), 0);
    if (bodyChars > MAX_OUTPUT_CHARS) throw Error(`The nested program would be over ${MAX_OUTPUT_CHARS / 1e6} MB. Reduce the file copy counts.`);
    built = Core.buildGcode(entries.map(entry => entry.src), layout, opts);
    geo = Core.previewGeometry(entries.map(entry => entry.src), layout, opts);
    code = built.text;
    codeTruncated = code.length > PREVIEW_CHARS;
    $('output').value = codeTruncated ? code.slice(0, PREVIEW_CHARS) + '\n… preview truncated; Save As uses the full program.' : code;
    $('save').disabled = window.parent === window || savePending;
    $('copy').disabled = false;
    $('pickOrigin').disabled = false;
    const est = Core.analyze(code, { rapid: o.rapid });
    const v = layout.verify;
    $('summary').textContent = `${layout.count} parts from ${entries.length} file${entries.length === 1 ? '' : 's'} · frame ${fmt(layout.frame.w, 1)} × ${fmt(layout.frame.h, 1)} mm · ${fmt(layout.utilization * 100, 0)}% used`
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
    if (!entries.length) {
      $('summary').textContent = 'Add files to begin.';
      el('text', { x: 50, y: 50, 'text-anchor': 'middle', 'font-size': 5 }, svg).textContent = 'Add files to preview';
      return;
    }
    if (!layout || !geo || !built) { drawPart(svg); return; }

    const a = built.anchor, f = layout.frame;
    // Draw the sheet in stable layout coordinates. The output origin is the
    // crosshair inside that sheet, so changing the origin moves only the
    // crosshair instead of shifting the artwork under the camera.
    const frame = [{ x: 0, y: 0 }, { x: f.w, y: f.h }];
    const outputPoint = p => ({ x: p.x + a.x, y: p.y + a.y });
    const size = fit([...frame, a]);
    const partSize = Math.max(...entries.map(entry => Math.max(entry.src.bbox.maxX - entry.src.bbox.minX, entry.src.bbox.maxY - entry.src.bbox.minY) * entry.src.mmPerUnit));
    const font = Math.max(partSize * 0.09, size * 0.012);
    el('rect', { x: 0, y: -f.h, width: f.w, height: f.h, fill: 'none', stroke: '#718196', 'stroke-width': 1, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, svg);
    // Travel: work zero -> first cut -> ... -> last cut -> work zero (the program's park move).
    let prev = a;
    const travel = el('g', {}, svg);
    const dash = (from, to) => el('line', { x1: from.x, y1: -from.y, x2: to.x, y2: -to.y, stroke: '#ffbf69', 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.6, 'vector-effect': 'non-scaling-stroke' }, travel);
    for (const item of geo.sequence) { const start = outputPoint(item.start), end = outputPoint(item.end); dash(prev, start); prev = end; }
    dash(prev, a);
    for (const p of geo.parts) {
      const g = el('g', { 'data-part': p.index + 1 }, svg);
      for (const c of p.contours) {
        const points = c.pts.map(outputPoint);
        if (c.top) {
          el('polygon', { points: pointList(points), fill: 'rgba(145,207,158,.14)', stroke: '#91cf9e', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, g);
        } else {
          el('polyline', { points: pointList(points), fill: 'none', stroke: '#5f8a69', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, g);
        }
      }
    }
    for (const item of geo.sequence) {
      const start = outputPoint(item.start);
      const g = el('g', { 'data-cut': item.seq }, svg);
      el('circle', { cx: start.x, cy: -start.y, r: size * 0.005, fill: '#ffbf69' }, g);
      const t = el('text', { x: start.x + font * 0.35, y: -start.y - font * 0.5, 'font-size': font, 'pointer-events': 'none' }, g);
      t.textContent = String(item.seq);
      const part = geo.parts[item.part];
      const file = entries[item.sourceIndex];
      el('title', {}, g).textContent = `Cut ${item.seq} · ${file?.name || 'file'} · ${item.internal ? 'inner' : 'outer'} cut · rotated ${fmt(part.angle, 2)}°`;
    }
    el('path', { d: `M ${a.x - size * 0.02} ${-a.y} H ${a.x + size * 0.02} M ${a.x} ${-a.y - size * 0.02} V ${-a.y + size * 0.02}`, stroke: '#ff7272', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, svg);
  }
  function drawPart(svg) {
    const gap = Math.max(...entries.map(entry => Math.max(entry.src.bbox.maxX - entry.src.bbox.minX, entry.src.bbox.maxY - entry.src.bbox.minY) * entry.src.mmPerUnit)) * 0.35;
    let offsetX = 0;
    const all = [];
    const shapes = entries.map(entry => {
      const src = entry.src, s = src.mmPerUnit;
      const w = (src.bbox.maxX - src.bbox.minX) * s;
      const map = p => ({ x: (p.x - src.center.x) * s + offsetX + w / 2, y: (p.y - src.center.y) * s });
      const contours = src.contours.map(c => ({ ...c, pts: c.pts.map(map) }));
      contours.forEach(c => all.push(...c.pts));
      const first = map(src.firstPoint);
      offsetX += w + gap;
      return { entry, contours, first };
    });
    const size = fit(all);
    shapes.forEach(({ entry, contours, first }) => {
      contours.forEach(c => {
        if (c.top) el('polygon', { points: pointList(c.pts), fill: 'rgba(145,207,158,.14)', stroke: '#91cf9e', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, svg);
        else el('polyline', { points: pointList(c.pts), fill: 'none', stroke: '#5f8a69', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, svg);
      });
      el('circle', { cx: first.x, cy: -first.y, r: size * 0.008, fill: '#ffbf69' }, svg);
    });
    $('summary').textContent = `${entries.length} file${entries.length === 1 ? '' : 's'} loaded · nest to generate the combined layout`;
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
    if (!entries.length) return;
    event.preventDefault();
    const m = $('preview').getScreenCTM();
    if (!m) return;
    zoom(Math.exp(-event.deltaY * 0.002), new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse()));
  }, { passive: false });
  let pan = null, pinch = null, suppressClick = false;
  const pointers = new Map();
  function screenPoint(event, inverse) { return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse); }
  function pointerPair() { return [...pointers.values()].slice(0, 2); }
  $('preview').addEventListener('pointerdown', event => {
    suppressClick = false;
    if (!entries.length || picking || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const m = $('preview').getScreenCTM();
    if (!m) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    $('preview').setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      pan = { id: event.pointerId, x: event.clientX, y: event.clientY, box: { ...viewBox }, inverse: m.inverse() };
      pinch = null;
    } else if (pointers.size === 2) {
      const [one, two] = pointerPair();
      pinch = { start: { ...viewBox }, inverse: m.inverse(), center: { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 }, distance: Math.max(1, Math.hypot(one.x - two.x, one.y - two.y)) };
      pan = null;
      suppressClick = true;
    }
  });
  $('preview').addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch) {
      const [one, two] = pointerPair();
      if (!one || !two) return;
      const center = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 };
      const distance = Math.max(1, Math.hypot(one.x - two.x, one.y - two.y));
      const q = screenPoint({ clientX: pinch.center.x, clientY: pinch.center.y }, pinch.inverse);
      const now = screenPoint({ clientX: center.x, clientY: center.y }, pinch.inverse);
      const scale = Math.max(1, Math.min(32, fitBox.w / pinch.start.w * distance / pinch.distance));
      const w = fitBox.w / scale, h = fitBox.h / scale;
      const x = q.x - (q.x - pinch.start.x) * w / pinch.start.w + q.x - now.x;
      const y = q.y - (q.y - pinch.start.y) * h / pinch.start.h + q.y - now.y;
      viewBox = { x, y, w, h };
      suppressClick = true;
      applyView();
      return;
    }
    if (!pan || pan.id !== event.pointerId) return;
    const from = new DOMPoint(pan.x, pan.y).matrixTransform(pan.inverse);
    const to = new DOMPoint(event.clientX, event.clientY).matrixTransform(pan.inverse);
    if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 3) suppressClick = true;
    viewBox = { ...pan.box, x: pan.box.x + from.x - to.x, y: pan.box.y + from.y - to.y };
    applyView();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('preview').addEventListener(ev, event => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) pan = null;
  });
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
    // Preview is drawn in sheet coordinates; custom origin is measured from the frame's bottom-left.
    $('origin').value = 'custom';
    $('originX').value = p.x.toFixed(3);
    $('originY').value = (-p.y).toFixed(3);
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
    if (id === 'rapid' && entries.length) { refreshFileList(); updateFileSummary(); }
    if (layout && id === 'origin' && $('prefer').value === 'compact' && ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'center'].includes($('origin').value)) {
      invalidate();
      viewBox = null;
      draw();
      message('Origin changed. Click Nest & generate to repack the compact block toward the new origin.');
      saveLastSoon();
      return;
    }
    if (layout) {
      try { regenerate(); } catch (e) { message(e.message, true); }
    }
    saveLastSoon();
  }));
  $('nest').onclick = runNest;
  $('stop').onclick = () => { if (ctl) ctl.cancelled = true; };

  $('file').addEventListener('change', async () => {
    const files = [...$('file').files];
    if (!files.length) return;
    try {
      for (const file of files) addText(await file.text(), file.name);
      refreshFiles();
      message(`Added ${files.length} file${files.length === 1 ? '' : 's'}. Set copies, then click Nest & generate.`);
    } catch (e) {
      message(e.message, true);
    } finally { $('file').value = ''; }
  });
  $('example').onclick = () => {
    try {
      addText(SAMPLE, 'Example: 40 x 30 mm triangle');
      refreshFiles();
      message('Added the example file. Set its copy count, then click Nest & generate.');
    } catch (e) { message(e.message, true); }
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
      if (entries.some(entry => entry.text === String(text))) {
        refreshFiles();
        if (announce) message(`${name} is already in the Files tab.`);
        return;
      }
      addText(String(text), name);
      refreshFiles();
      message(`Added ${name}. Set copies, then click Nest & generate.`);
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
