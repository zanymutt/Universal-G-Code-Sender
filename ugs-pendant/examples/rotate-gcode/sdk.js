// Small Dashboard bridge used by the Rotate G-code example.
(function () {
  let nextId = 1;
  const pending = new Map();

  window.addEventListener("message", event => {
    const data = event.data;
    if (!data) return;
    if (data.type !== "fluid-response") return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error !== undefined) request.reject(new Error(data.error));
    else request.resolve(data.result);
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
  };
})();
