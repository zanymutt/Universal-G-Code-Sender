// downloadFile(): a plugin's sandbox has no allow-downloads, so a Blob +
// <a download> inside the iframe is silently blocked. This does the same thing
// from the dashboard page instead - but only for plain-text data formats and
// with a sanitized name, so a plugin can't use it to drop an executable or a
// script into the person's Downloads folder. The file type is decided by the
// extension here, never by a plugin-supplied MIME type.
export const DOWNLOAD_MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  json: "application/json",
  nc: "text/plain",
  ngc: "text/plain",
  gcode: "text/plain",
  tap: "text/plain",
  svg: "image/svg+xml",
};
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

// The File System Access API isn't in every TypeScript DOM lib, and only
// Chromium browsers (Chrome, Edge) have it, so it's typed and feature-checked
// here rather than assumed.
type SaveFilePicker = (options: {
  suggestedName: string;
  id: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;

const saveWithPicker = async (
  picker: SaveFilePicker,
  name: string,
  extension: string,
  blob: Blob
): Promise<{ filename: string } | null> => {
  try {
    const handle = await picker({
      suggestedName: name,
      // Same id every time, so the dialog reopens in the folder last used.
      id: "ugs-plugin-export",
      types: [{ description: `${extension.toUpperCase()} file`, accept: { [blob.type]: [`.${extension}`] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { filename: handle.name };
  } catch (error) {
    // The person closed the Save As dialog: that's an answer, not a failure -
    // don't quietly download the file to Downloads behind their back.
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw new Error("Save cancelled");
    }
    // Anything else (no click left to authorise the dialog, a browser/policy
    // block...) just means the normal download below is used instead.
    return null;
  }
};

export const downloadTextFile = async (filename: unknown, content: unknown): Promise<{ filename: string }> => {
  if (typeof filename !== "string" || typeof content !== "string") {
    throw new Error("downloadFile needs a filename string and a content string");
  }
  const safeName = (filename.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120);
  const extension = safeName.includes(".") ? (safeName.split(".").pop() ?? "").toLowerCase() : "";
  const mimeType = DOWNLOAD_MIME_BY_EXTENSION[extension];
  if (!safeName || !mimeType) {
    throw new Error(`downloadFile only saves ${Object.keys(DOWNLOAD_MIME_BY_EXTENSION).join(", ")} files`);
  }
  const blob = new Blob([content], { type: mimeType });
  if (blob.size > MAX_DOWNLOAD_BYTES) {
    throw new Error("downloadFile is limited to 25 MB per file");
  }

  // Preferred: a real Save As dialog, so the person chooses the folder and
  // name. A click inside the plugin iframe also counts as the user gesture the
  // dialog needs on this page, as long as the request arrives right away. The
  // API needs a secure context - http://localhost qualifies, a LAN IP over
  // plain http does not - so a tablet on the LAN gets the plain download.
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === "function" && window.isSecureContext) {
    const saved = await saveWithPicker(picker.bind(window), safeName, extension, blob);
    if (saved) return saved;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { filename: safeName };
};
