// "Press the input to bind" is in progress. Shortcuts that act on controller
// input stand down while it is, so the press being learned doesn't also do its
// job (a jog, a stop) as it is assigned.
let capturing = false;

export const setInputCapturing = (value: boolean) => {
  capturing = value;
};

export const isInputCapturing = () => capturing;
