// Minimal bridge to the Dashboard host. Each call posts a
// {type:'fluid-request', id, method, params} message to the parent window
// and resolves once a matching {type:'fluid-response', id, ...} message
// comes back. Events the host pushes unprompted (status/line) arrive as
// {type:'fluid-event', event, data} and are dispatched to whatever
// on(event, cb) listeners are currently registered.
//
// Note for anyone extending this plugin: the host iframe is sandboxed with
// sandbox="allow-scripts" and no allow-modals, so window.alert/confirm/
// prompt are all silently blocked - use the page's own UI for anything a
// normal plugin might have reached for a prompt() dialog to do.
(function () {
  let nextId = 1;
  const pending = new Map();
  const listeners = { status: [], line: [] };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data) return;

    if (data.type === "fluid-response") {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
      return;
    }

    if (data.type === "fluid-event") {
      (listeners[data.event] || []).forEach((cb) => cb(data.data));
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
    getStatus: () => call("getStatus"),
    sendCommand: (command) => call("sendCommand", { command }),
    getGcode: () => call("getGcode"),
    setGcode: (content) => call("setGcode", { content }),
    // No filename/path here - the dashboard's own Save As dialog (folder
    // tree, new-folder button, remembered last location) collects where it
    // actually goes. Resolves with { path } once saved, rejects if cancelled.
    saveGcodeAs: (content) => call("saveGcodeAs", { content }),
    listFiles: () => call("listFiles"),
    openFile: (path) => call("openFile", { path }),
    // Opens the dashboard's own Open dialog (folder tree, search, all of
    // it) and resolves with the chosen path once picked, without loading
    // it as the active file - rejects if the person cancels.
    pickFile: () => call("pickFile"),
    // The currently-loaded file's name and send progress - not part of
    // getStatus() (that's controller state, this is GUIBackend's own
    // send-progress tracking). fileName is the backend's own absolute path,
    // not the workspace-relative path openFile()/listFiles() use.
    getFileStatus: () => call("getFileStatus"),
    // Starts sending the currently loaded file - also how you resume after
    // pauseSend(), same as the dashboard's own Start button doubling as
    // Resume once the machine is in HOLD.
    startSend: () => call("startSend"),
    pauseSend: () => call("pauseSend"),
    stopSend: () => call("stopSend"),
    getSettings: () => call("getSettings"),
    saveSettings: (data) => call("saveSettings", { data }),
    close: () => call("close"),
    on: (event, cb) => {
      (listeners[event] || (listeners[event] = [])).push(cb);
      return call("subscribe", { event });
    },
    off: (event, cb) => {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
      return call("unsubscribe", { event });
    },
  };
})();
