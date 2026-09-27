// Small Dashboard bridge used by the Rotate G-code example.
(function () {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map(); // event name -> Set<callback>

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
