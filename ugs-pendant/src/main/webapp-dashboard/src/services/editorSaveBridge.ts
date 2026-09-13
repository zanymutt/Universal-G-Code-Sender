// GcodeEditor stays mounted (just hidden) regardless of which CenterPanel tab
// is active (see CenterPanel's own comment), so it's always the one place
// holding the actual live, possibly-unsaved CodeMirror buffer - but the job
// bar (which needs to trigger a save before running, from wherever it is in
// the layout) has no direct reference to that component. A plain module-level
// handler is the simplest bridge between them: GcodeEditor registers its own
// save function once on mount, JobBar calls it without either needing to know
// the other exists. Redux wasn't a fit here - this needs a synchronous
// "give me a promise for what saving does right now" call, not a store value.
let saveHandler: (() => Promise<void>) | null = null;

export function registerEditorSaveHandler(handler: (() => Promise<void>) | null) {
  saveHandler = handler;
}

export function saveEditorContent(): Promise<void> {
  if (!saveHandler) {
    return Promise.reject(new Error("No gcode file is open to save"));
  }
  return saveHandler();
}
