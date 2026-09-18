// Batch Runner uses explicit backend sendState plus controller IDLE.
// Cancellation and time estimates must never be treated as successful completion.
window.BatchRunner = (function () {
  const POLL_INTERVAL_MS = 750;
  const LOAD_CONFIRM_TIMEOUT_MS = 15000;

  let queue = [];
  let batchState = "idle"; // idle | running | waiting-continue | complete | stopped
  let currentIndex = -1;
  let autoAdvance = true;
  let controllerState = "UNKNOWN";
  let lastFileStatus = null;
  let pollTimer = null;
  let onChange = () => {};
  let seenRunning = false;
  // Bumped by start() and stopBatch() - runCurrentFile()'s own promise chain
  // (openFile -> waitForFileLoaded -> startSend) captures whatever value was
  // current when it began and checks it again after each step. Without
  // this, pressing Stop mid-chain didn't stop anything: nothing in that
  // chain ever looked at batchState, so it ran startSend() regardless,
  // starting a job seconds after the person told it to stop (confirmed
  // 2026-09-18: openFile -> stopSend -> startSend leaves the UI showing
  // "stopped" while the machine starts moving anyway).
  let runGeneration = 0;
  const ABORTED = Symbol("batch run superseded");

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logLines.push(line);
    if (state.logLines.length > 300) state.logLines.shift();
    emit();
  }

  const state = { logLines: [] };

  function emit() {
    onChange({
      queue: queue.slice(),
      batchState,
      currentIndex,
      autoAdvance,
      controllerState,
      lastFileStatus,
      logLines: state.logLines,
    });
  }

  // getFileStatus().fileName is the backend's absolute on-disk path; paths
  // here are workspace-relative ("CustomerA/lid.gcode"). Compare by suffix,
  // normalizing backslashes, rather than needing to know the workspace root.
  function pathsMatch(absoluteFileName, relativePath) {
    if (!absoluteFileName) return false;
    const a = absoluteFileName.replace(/\\/g, "/");
    const b = relativePath.replace(/\\/g, "/");
    return a === b || a.endsWith("/" + b);
  }

  function addFiles(paths) {
    const existing = new Set(queue.map((item) => item.path));
    paths.forEach((path) => {
      if (!existing.has(path)) {
        queue.push({ path, status: "pending" });
        existing.add(path);
      }
    });
    emit();
  }

  function removeAt(index) {
    if (batchState === "running" || batchState === "waiting-continue") return;
    queue.splice(index, 1);
    emit();
  }

  function clearQueue() {
    if (batchState === "running" || batchState === "waiting-continue") return;
    queue = [];
    emit();
  }

  function setAutoAdvance(value) {
    autoAdvance = value;
    emit();
  }

  function waitForFileLoaded(relativePath) {
    const deadline = Date.now() + LOAD_CONFIRM_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      function check() {
        window.Fluid.getFileStatus()
          .then((fileStatus) => {
            if (pathsMatch(fileStatus.fileName, relativePath)) {
              resolve(fileStatus);
              return;
            }
            if (Date.now() > deadline) {
              reject(new Error("Timed out waiting for the file to finish loading"));
              return;
            }
            setTimeout(check, 250);
          })
          .catch(reject);
      }
      check();
    });
  }

  function runCurrentFile() {
    if (currentIndex >= queue.length) {
      batchState = "complete";
      log("Batch complete.");
      stopPolling();
      emit();
      return;
    }

    const myGeneration = ++runGeneration;
    const isCurrent = () => myGeneration === runGeneration && batchState === "running";

    const item = queue[currentIndex];
    item.status = "running";
    seenRunning = false;
    lastFileStatus = null;
    emit();
    log(`Opening "${item.path}" (${currentIndex + 1} of ${queue.length})...`);

    window.Fluid.openFile(item.path)
      .then(() => {
        if (!isCurrent()) throw ABORTED;
        return waitForFileLoaded(item.path);
      })
      .then(() => {
        if (!isCurrent()) throw ABORTED;
        return window.Fluid.startSend();
      })
      .then(() => {
        if (!isCurrent()) throw ABORTED;
        log(`Running "${item.path}"...`);
        startPolling();
      })
      .catch((err) => {
        // Superseded by a Stop (or a fresh Start) in the meantime - that
        // path has already updated state/logged/emitted for itself, so
        // there's nothing left to do here except NOT call startSend().
        if (err === ABORTED || !isCurrent()) return;
        item.status = "error";
        batchState = "stopped";
        log(`Couldn't start "${item.path}": ${err.message}. Batch stopped.`);
        emit();
      });
  }

  function handleFileFinished(finalFileStatus, generation) {
    if (generation !== runGeneration || batchState !== "running") return;
    const item = queue[currentIndex];
    // A status notification can precede the backend's stream-complete event.
    // Keep polling until its lifecycle state is terminal, then require IDLE
    // before advancing to another file. Unknown/old servers fail closed.
    if (finalFileStatus && ["RUNNING", "PAUSED"].includes(finalFileStatus.sendState)) return;
    if (finalFileStatus?.sendState === "COMPLETED" && controllerState !== "IDLE") return;
    const completedOk = finalFileStatus?.sendState === "COMPLETED" &&
      pathsMatch(finalFileStatus.fileName, item.path);
    seenRunning = false;

    stopPolling();

    if (!completedOk) {
      item.status = "stopped";
      batchState = "stopped";
      log(`"${item.path}" stopped before finishing - batch halted.`);
      emit();
      return;
    }

    item.status = "done";
    log(`Finished "${item.path}".`);
    currentIndex += 1;

    if (currentIndex >= queue.length) {
      batchState = "complete";
      log("Batch complete.");
      emit();
      return;
    }

    if (autoAdvance) {
      runCurrentFile();
    } else {
      batchState = "waiting-continue";
      log("Waiting for you to press Continue for the next file.");
      emit();
    }
  }

  function startPolling() {
    stopPolling();
    const generation = runGeneration;
    pollTimer = setInterval(() => {
      window.Fluid.getFileStatus()
        .then((fileStatus) => {
          if (generation !== runGeneration || batchState !== "running") return;
          lastFileStatus = fileStatus;
          if (controllerState === "IDLE") handleFileFinished(fileStatus, generation);
          emit();
        })
        .catch(() => {
          /* transient - next tick will retry */
        });
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function handleStatusEvent(status) {
    const previous = controllerState;
    controllerState = status.state;
    emit();

    if (batchState !== "running") return;

    if (previous === "RUN" || previous === "CHECK") seenRunning = true;

    if (status.state === "ALARM" && (currentIndex >= 0 && currentIndex < queue.length)) {
      const item = queue[currentIndex];
      runGeneration += 1;
      item.status = "error";
      batchState = "stopped";
      stopPolling();
      log(`ALARM while running "${item.path}" - batch stopped.`);
      emit();
      return;
    }

    // Only treat a return to IDLE as "this file might be done" once we've
    // actually observed it running - the state right after openFile()
    // resolves but before startSend() takes effect is IDLE too.
    if (status.state === "IDLE" && seenRunning) {
      const generation = runGeneration;
      window.Fluid.getFileStatus()
        .then((fileStatus) => handleFileFinished(fileStatus, generation))
        .catch(() => handleFileFinished(null, generation));
    }
  }

  function start() {
    if (queue.length === 0) {
      log("Add at least one file to the queue first.");
      return;
    }
    runGeneration += 1;
    queue.forEach((item) => (item.status = "pending"));
    currentIndex = 0;
    batchState = "running";
    emit();
    runCurrentFile();
  }

  function continueNext() {
    if (batchState !== "waiting-continue") return;
    batchState = "running";
    emit();
    runCurrentFile();
  }

  function pauseOrResumeCurrent() {
    if (controllerState === "RUN" || controllerState === "CHECK") {
      window.Fluid.pauseSend().catch((err) => log(`Pause failed: ${err.message}`));
    } else if (controllerState === "HOLD") {
      window.Fluid.startSend().catch((err) => log(`Resume failed: ${err.message}`));
    }
  }

  function stopBatch() {
    // Invalidates any in-flight runCurrentFile() chain immediately - see the
    // runGeneration comment up top.
    runGeneration += 1;
    stopPolling();
    const wasRunning = batchState === "running" || batchState === "waiting-continue";
    batchState = "stopped";
    if (currentIndex >= 0 && currentIndex < queue.length && queue[currentIndex].status === "running") {
      queue[currentIndex].status = "stopped";
    }
    emit();
    if (wasRunning) {
      window.Fluid.stopSend().catch(() => {
        /* best-effort - nothing left running is also a fine outcome */
      });
      log("Batch stopped by user.");
    }
  }

  function init(callback) {
    onChange = callback;
    window.Fluid.on("status", handleStatusEvent);
    window.Fluid.getStatus().then((status) => {
      controllerState = status.state;
      emit();
    });
    emit();
  }

  return {
    init,
    addFiles,
    removeAt,
    clearQueue,
    setAutoAdvance,
    start,
    continueNext,
    pauseOrResumeCurrent,
    stopBatch,
  };
})();
