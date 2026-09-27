(function () {
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => $(tab.getAttribute("aria-controls")));
  const defaults = {
    angle: 0,
    scale: 1,
    flipHorizontal: false,
    flipVertical: false,
    pivotMode: "center",
    origin: "keep",
    customOrigin: { x: 0, y: 0 },
  };
  const state = {
    originalText: null,
    fileName: "",
    savedSettings: {},
    settings: { ...defaults },
    presets: {},
    result: null,
    transformFrame: 0,
    saveTimer: 0,
    picking: false,
    dragging: null,
    baseView: null,
    view: null,
    zoom: 1,
  };

  function message(text, error = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  }

  function showTab(tab) {
    tabs.forEach((candidate, index) => {
      const active = candidate === tab;
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
      panels[index].hidden = !active;
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showTab(tab));
    tab.addEventListener("keydown", event => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      showTab(tabs[next]);
      tabs[next].focus();
    });
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readSettings() {
    const angle = Number($("angle").value);
    const scalePercent = Number($("scale").value);
    const customX = Number($("customX").value);
    const customY = Number($("customY").value);
    return {
      angle: Number.isFinite(angle) ? clamp(angle, -180, 180) : 0,
      scale: Number.isFinite(scalePercent) ? clamp(scalePercent, 1, 1000) / 100 : 1,
      flipHorizontal: $("flipHorizontal").checked,
      flipVertical: $("flipVertical").checked,
      pivotMode: $("pivotMode").value,
      origin: $("origin").value,
      customOrigin: {
        x: Number.isFinite(customX) ? customX : 0,
        y: Number.isFinite(customY) ? customY : 0,
      },
    };
  }

  function writeSettings(next) {
    state.settings = {
      ...defaults,
      ...next,
      angle: clamp(Number(next.angle) || 0, -180, 180),
      scale: clamp(Number(next.scale) || 1, 0.01, 10),
      customOrigin: { ...defaults.customOrigin, ...(next.customOrigin || {}) },
    };
    $("angle").value = String(state.settings.angle);
    $("angleSlider").value = String(Math.round(state.settings.angle));
    $("angleValue").textContent = `${state.settings.angle}°`;
    const percent = state.settings.scale * 100;
    $("scale").value = String(percent);
    $("scaleSlider").value = String(clamp(percent, 1, 300));
    $("scaleValue").textContent = `${formatNumber(percent)}%`;
    $("flipHorizontal").checked = state.settings.flipHorizontal;
    $("flipVertical").checked = state.settings.flipVertical;
    $("pivotMode").value = state.settings.pivotMode;
    $("origin").value = state.settings.origin;
    $("customX").value = String(state.settings.customOrigin.x);
    $("customY").value = String(state.settings.customOrigin.y);
  }

  function formatNumber(value) {
    return Number(value).toFixed(3).replace(/\.?(0+)$/, "");
  }

  function scheduleSaveSettings() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      const payload = {
        ...state.savedSettings,
        rotateGcode: state.settings,
        presets: state.presets,
      };
      Fluid.saveSettings(payload).catch(() => {});
    }, 250);
  }

  function currentOptions() {
    state.settings = readSettings();
    scheduleSaveSettings();
    return state.settings;
  }

  function requestTransform() {
    cancelAnimationFrame(state.transformFrame);
    state.transformFrame = requestAnimationFrame(recompute);
  }

  function recompute() {
    if (state.originalText === null) return;
    const options = currentOptions();
    state.result = window.transformGcode(state.originalText, options);
    $("output").value = state.result.text;
    $("copy").disabled = false;
    $("save").disabled = false;
    $("saveAs").disabled = false;
    const b = state.result.outputBounds;
    const width = b.maxX - b.minX;
    const height = b.maxY - b.minY;
    $("summary").textContent = `${state.result.transformedLineCount} motion lines · ${formatNumber(width)} × ${formatNumber(height)} · pivot (${formatNumber(state.result.pivot.x)}, ${formatNumber(state.result.pivot.y)}) · translation (${formatNumber(state.result.translation.x)}, ${formatNumber(state.result.translation.y)})`;
    updateViewForBounds(b);
    drawPreview();
    message("Preview updated. Nothing has been sent to the machine.");
  }

  function updateViewForBounds(bounds) {
    const width = Math.max(bounds.maxX - bounds.minX, 1);
    const height = Math.max(bounds.maxY - bounds.minY, 1);
    const margin = Math.max(width, height) * 0.08 + 0.5;
    const base = {
      x: bounds.minX - margin,
      y: -(bounds.maxY + margin),
      w: width + margin * 2,
      h: height + margin * 2,
    };
    const first = !state.baseView;
    state.baseView = base;
    if (first) state.zoom = 1;
    const cx = (base.x + base.w / 2);
    const cy = (base.y + base.h / 2);
    state.view = {
      w: base.w / state.zoom,
      h: base.h / state.zoom,
      x: cx - base.w / state.zoom / 2,
      y: cy - base.h / state.zoom / 2,
    };
    $("zoomLevel").textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function svgElement(name, attrs) {
    const element = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function drawPreview() {
    const svg = $("preview");
    svg.replaceChildren();
    if (!state.result || !state.view) return;
    svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    const group = svgElement("g", {});
    state.result.preview.outputSegments.forEach(segment => {
      const points = segment.points.map(point => `${point[0]},${-point[1]}`).join(" ");
      group.appendChild(svgElement("polyline", { points, class: segment.rapid ? "rapid" : "cut" }));
    });
    const x0 = state.view.x - state.view.w;
    const x1 = state.view.x + state.view.w * 2;
    const y0 = -state.view.y - state.view.h * 2;
    const y1 = -state.view.y + state.view.h;
    group.appendChild(svgElement("line", { x1: x0, y1: 0, x2: x1, y2: 0, class: "axis" }));
    group.appendChild(svgElement("line", { x1: 0, y1: y0, x2: 0, y2: y1, class: "axis" }));
    const cross = Math.max(state.view.w, state.view.h) * 0.025;
    group.appendChild(svgElement("path", { d: `M ${-cross} 0 H ${cross} M 0 ${-cross} V ${cross}`, class: "origin" }));
    svg.appendChild(group);
  }

  function zoomBy(factor, around) {
    if (!state.view || !state.baseView) return;
    const nextZoom = clamp(state.zoom * factor, 0.25, 20);
    const point = around || [state.view.x + state.view.w / 2, state.view.y + state.view.h / 2];
    const ratio = nextZoom / state.zoom;
    const newW = state.view.w / ratio;
    const newH = state.view.h / ratio;
    state.view = {
      x: point[0] - (point[0] - state.view.x) / ratio,
      y: point[1] - (point[1] - state.view.y) / ratio,
      w: newW,
      h: newH,
    };
    state.zoom = nextZoom;
    $("zoomLevel").textContent = `${Math.round(state.zoom * 100)}%`;
    drawPreview();
  }

  function fitPreview() {
    if (!state.result) return;
    state.baseView = null;
    updateViewForBounds(state.result.outputBounds);
    drawPreview();
  }

  function screenToWorld(event) {
    const matrix = $("preview").getScreenCTM();
    if (!matrix) return [0, 0];
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, -point.y];
  }

  function inverseVector(x, y, options) {
    const angle = (options.angle * Math.PI) / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let dx = x * cos + y * sin;
    let dy = -x * sin + y * cos;
    if (options.flipHorizontal) dx = -dx;
    if (options.flipVertical) dy = -dy;
    return [dx / options.scale, dy / options.scale];
  }

  function sourcePointFromOutput(point) {
    const result = state.result;
    const options = readSettings();
    const translated = [point[0] - result.translation.x, point[1] - result.translation.y];
    const vector = inverseVector(translated[0] - result.pivot.x, translated[1] - result.pivot.y, options);
    return [result.pivot.x + vector[0], result.pivot.y + vector[1]];
  }

  function setPicking(value) {
    state.picking = value;
    $("preview").classList.toggle("picking", value);
    $("pickMode").classList.toggle("primary", value);
    $("pickOrigin").classList.toggle("primary", value);
    if (value) message("Click the preview to place the output origin. Press Escape to cancel.");
  }

  function onPreviewClick(event) {
    if (!state.picking || !state.result) return;
    const outputPoint = screenToWorld(event);
    const sourcePoint = sourcePointFromOutput(outputPoint);
    $("customX").value = formatNumber(sourcePoint[0]);
    $("customY").value = formatNumber(sourcePoint[1]);
    $("origin").value = "custom";
    setPicking(false);
    requestTransform();
  }

  function resetAfterSave(text, note) {
    state.originalText = text;
    writeSettings(defaults);
    $("fileInfo").textContent = `${state.fileName || "Current file"}\n${text.split(/\r?\n/).length} lines`;
    requestTransform();
    message(note);
  }

  async function loadCurrentFile() {
    state.originalText = null;
    state.result = null;
    state.baseView = null;
    $("output").value = "";
    $("copy").disabled = true;
    $("save").disabled = true;
    $("saveAs").disabled = true;
    $("fileInfo").textContent = "Loading current file…";
    message("Loading current file…");
    try {
      state.originalText = await Fluid.getGcode();
      const lines = state.originalText.split(/\r?\n/).length;
      $("fileInfo").textContent = `${state.fileName || "Current file"}\n${lines} lines`;
      requestTransform();
    } catch (error) {
      $("fileInfo").textContent = `Could not load the current file.\n${error.message}`;
      message("Open a G-code file in Dashboard, then reload this plugin.", true);
    }
  }

  function renderPresets() {
    const list = $("presetList");
    list.replaceChildren();
    Object.keys(state.presets).sort().forEach(name => {
      const row = document.createElement("li");
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = name;
      use.addEventListener("click", () => {
        writeSettings(state.presets[name]);
        requestTransform();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `Delete ${name}`;
      remove.addEventListener("click", () => {
        delete state.presets[name];
        renderPresets();
        scheduleSaveSettings();
      });
      row.append(use, remove);
      list.appendChild(row);
    });
  }

  function bindControls() {
    const anglePresets = [-135, -90, -45, 0, 45, 90, 135, 180];
    anglePresets.forEach(angle => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${angle}°`;
      button.addEventListener("click", () => {
        $("angle").value = String(angle);
        $("angleSlider").value = String(angle);
        $("angleValue").textContent = `${angle}°`;
        requestTransform();
      });
      $("anglePresets").appendChild(button);
    });
    $("angleSlider").addEventListener("input", event => {
      $("angle").value = event.target.value;
      $("angleValue").textContent = `${event.target.value}°`;
      requestTransform();
    });
    $("angle").addEventListener("input", event => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      event.target.value = String(clamp(value, -180, 180));
      $("angleSlider").value = event.target.value;
      $("angleValue").textContent = `${event.target.value}°`;
      requestTransform();
    });
    $("scaleSlider").addEventListener("input", event => {
      $("scale").value = event.target.value;
      $("scaleValue").textContent = `${event.target.value}%`;
      requestTransform();
    });
    $("scale").addEventListener("input", event => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      event.target.value = String(clamp(value, 1, 1000));
      $("scaleSlider").value = String(clamp(value, 1, 300));
      $("scaleValue").textContent = `${formatNumber(value)}%`;
      requestTransform();
    });
    ["flipHorizontal", "flipVertical", "pivotMode", "origin", "customX", "customY"].forEach(id => {
      $(id).addEventListener("input", requestTransform);
      $(id).addEventListener("change", requestTransform);
    });
    $("reload").addEventListener("click", loadCurrentFile);
    $("fitFile").addEventListener("click", fitPreview);
    $("zoomFit").addEventListener("click", fitPreview);
    $("zoomIn").addEventListener("click", () => zoomBy(1.25));
    $("zoomOut").addEventListener("click", () => zoomBy(0.8));
    $("pickMode").addEventListener("click", () => setPicking(!state.picking));
    $("pickOrigin").addEventListener("click", () => setPicking(!state.picking));
    $("preview").addEventListener("click", onPreviewClick);
    $("preview").addEventListener("wheel", event => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.15 : 0.87, screenToWorld(event).map((value, index) => index ? -value : value));
    }, { passive: false });
    $("preview").addEventListener("pointerdown", event => {
      if (state.picking || event.button !== 0 || !state.view) return;
      state.dragging = { x: event.clientX, y: event.clientY, view: { ...state.view } };
      $("preview").setPointerCapture(event.pointerId);
    });
    $("preview").addEventListener("pointermove", event => {
      if (!state.dragging) return;
      const svg = $("preview");
      const dx = (event.clientX - state.dragging.x) * state.dragging.view.w / svg.clientWidth;
      const dy = (event.clientY - state.dragging.y) * state.dragging.view.h / svg.clientHeight;
      state.view = { ...state.dragging.view, x: state.dragging.view.x - dx, y: state.dragging.view.y - dy };
      drawPreview();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(name => $("preview").addEventListener(name, () => { state.dragging = null; }));
    window.addEventListener("keydown", event => { if (event.key === "Escape" && state.picking) setPicking(false); });
    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(state.result.text); message("Generated G-code copied to the clipboard."); }
      catch { message("Clipboard access was unavailable.", true); }
    });
    $("save").addEventListener("click", async () => {
      if (!state.result) return;
      $("save").disabled = true;
      try { await Fluid.setGcode(state.result.text); resetAfterSave(state.result.text, "Saved and reloaded the transformed G-code."); }
      catch (error) { message(`Save failed: ${error.message}`, true); $("save").disabled = false; }
    });
    $("saveAs").addEventListener("click", async () => {
      if (!state.result) return;
      $("saveAs").disabled = true;
      try {
        const saved = await Fluid.saveGcodeAs(state.result.text);
        resetAfterSave(state.result.text, `Saved as ${saved.path || "a new file"}.`);
      } catch (error) { message(`Save cancelled or failed: ${error.message}`, true); }
      finally { $("saveAs").disabled = false; }
    });
    $("savePreset").addEventListener("click", () => {
      const name = $("presetName").value.trim();
      if (!name) { message("Enter a preset name first.", true); return; }
      state.presets[name] = { ...readSettings(), customOrigin: { ...readSettings().customOrigin } };
      $("presetName").value = "";
      renderPresets();
      scheduleSaveSettings();
      message(`Saved preset “${name}”.`);
    });
    $("divider").addEventListener("pointerdown", event => {
      event.preventDefault();
      $("divider").setPointerCapture(event.pointerId);
      const work = $("divider").parentElement;
      const vertical = getComputedStyle(work).gridTemplateColumns.trim().split(/\s+/).length > 1;
      const move = moveEvent => {
        const box = work.getBoundingClientRect();
        if (vertical) {
          const percent = clamp((moveEvent.clientX - box.left) / box.width * 100, 25, 75);
          work.style.gridTemplateColumns = `minmax(0, ${percent}%) 8px minmax(0, 1fr)`;
        } else {
          const percent = clamp((moveEvent.clientY - box.top) / box.height * 100, 25, 75);
          work.style.gridTemplateRows = `minmax(0, ${percent}%) 8px minmax(0, 1fr)`;
        }
      };
      const end = () => {
        $("divider").removeEventListener("pointermove", move);
        $("divider").removeEventListener("pointerup", end);
        $("divider").removeEventListener("pointercancel", end);
      };
      $("divider").addEventListener("pointermove", move);
      $("divider").addEventListener("pointerup", end);
      $("divider").addEventListener("pointercancel", end);
    });
  }

  async function start() {
    bindControls();
    try {
      const saved = await Fluid.getSettings();
      state.savedSettings = saved && typeof saved === "object" ? saved : {};
      state.presets = state.savedSettings.presets && typeof state.savedSettings.presets === "object" ? state.savedSettings.presets : {};
      writeSettings(state.savedSettings.rotateGcode || defaults);
      renderPresets();
    } catch {
      writeSettings(defaults);
    }
    await loadCurrentFile();
  }

  start();
})();
