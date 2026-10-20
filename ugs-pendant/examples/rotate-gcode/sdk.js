// Small Dashboard bridge used by the Transform G-code example.
(function () {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map(); // event name -> Set<callback>
  const colorHandlers = new Map(); // pickColor token -> onChange callback

  window.addEventListener("message", event => {
    const data = event.data;
    if (!data) return;
    if (data.type === "fluid-response") {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error !== undefined) request.reject(new Error(data.error));
      else request.resolve(data.result);
      return;
    }
    // A color the person settled on in a pickColor() picker that is still open.
    if (data.type === "fluid-event" && data.event === "color") {
      const handler = data.data && colorHandlers.get(data.data.token);
      if (handler) handler(data.data.color);
      return;
    }
    if (data.type === "fluid-event") {
      const handlers = listeners.get(data.event);
      if (handlers) handlers.forEach(callback => callback(data.data));
    }
  });

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ type: "fluid-request", id, method, params: params || {} }, "*");
    });
  }

  window.Fluid = {
    getGcode: () => call("getGcode"),
    setGcode: content => call("setGcode", { content }),
    saveGcodeAs: content => call("saveGcodeAs", { content }),
    getSettings: () => call("getSettings"),
    saveSettings: data => call("saveSettings", { data }),
    // { mode: "dark" | "light", colors: { background, surface, surfaceRaised,
    // border, text, textMuted, accent } } - the dashboard's current theme and
    // accent color, for a plugin that wants to look native. Also pushed as
    // a "theme" event (see on() below) whenever the person changes either
    // one while this window is open.
    getTheme: () => call("getTheme"),
    // Opens the dashboard's own color picker beside one of your controls and resolves, once it is closed, with
    // { color } - the last color the person settled on, or { color: null } if they closed it without picking.
    //   color     "#rrggbb" it starts on
    //   anchor    the control to open beside: an element, or { x, y, width, height } in this page's pixels
    //             (without one it opens in the middle of the window)
    //   onChange  (color) => void, called each time they let go of the mouse or finger on a color, while the
    //             picker is still open - not for every step of a drag
    // Use this instead of <input type="color">: that pop-up is the browser's, so it opens in the wrong place when
    // the dashboard is zoomed, and the page never hears when the mouse is released in it.
    pickColor(options) {
      const { color, anchor, onChange } = options || {};
      let box = anchor;
      if (anchor && typeof anchor.getBoundingClientRect === "function") {
        const rect = anchor.getBoundingClientRect();
        box = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      }
      const token = nextId++;
      if (onChange) colorHandlers.set(token, onChange);
      return call("pickColor", { color, token, ...(box || {}) }).finally(() => colorHandlers.delete(token));
    },
    // Subscribes on the first callback registered for an event, unsubscribes
    // once the last one is removed. Event names: "status", "line", "theme".
    on(event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
        call("subscribe", { event });
      }
      listeners.get(event).add(callback);
    },
    off(event, callback) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      handlers.delete(callback);
      if (handlers.size === 0) {
        listeners.delete(event);
        call("unsubscribe", { event });
      }
    },
  };
})();
