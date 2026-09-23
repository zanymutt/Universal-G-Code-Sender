import { useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileExport, faFileImport } from "@fortawesome/free-solid-svg-icons";
import {
  applyLayoutBackup, downloadLayoutBackup, hasSettings, layoutBackupFilename, parseLayoutBackup,
  type ImportSelection, type ParsedBackup,
} from "../utils/layoutBackup";

const describeSettings = (parsed: ParsedBackup) => {
  const { settings } = parsed.backup;
  const parts: string[] = [];
  if (settings.sizing) parts.push("screen layout & column widths");
  if (settings.zoom !== undefined) parts.push("zoom");
  if (settings.consoleFontSize !== undefined || settings.editorFontSize !== undefined) parts.push("font sizes");
  if (settings.paneLayout) parts.push("current panes");
  if (settings.pluginWindowSizes) parts.push("plugin window sizes");
  return parts.join(", ");
};

// Export/import of every saved layout and this device's layout settings as one JSON file. Browser
// storage is per device and is wiped by "clear site data", so this is the backup and the way to
// copy layouts to another device.
const LayoutBackupControls = () => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [selection, setSelection] = useState<ImportSelection>({ paneLayoutPresets: true, layoutPresets: true, settings: false });
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const report = (text: string, error = false) => { setMessage(text); setIsError(error); };

  const exportBackup = () => {
    try {
      downloadLayoutBackup();
      report(`Saved ${layoutBackupFilename()} to your downloads.`);
    } catch {
      report("Could not create the backup file in this browser.", true);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setParsed(null);
    const result = parseLayoutBackup(await file.text().catch(() => ""));
    if (!result.ok) { report(result.error, true); return; }
    const { backup } = result.value;
    setFileName(file.name);
    setSelection({
      paneLayoutPresets: backup.paneLayoutPresets.length > 0,
      layoutPresets: backup.layoutPresets.length > 0,
      settings: false,
    });
    setParsed(result.value);
    report("");
  };

  const importBackup = () => {
    if (!parsed) return;
    try {
      const result = applyLayoutBackup(parsed.backup, selection);
      const changes = [
        result.added || result.replaced ? `${result.added} added, ${result.replaced} replaced` : "",
        result.settingsApplied ? "settings restored" : "",
      ].filter(Boolean).join("; ");
      report(`Imported (${changes || "nothing to change"}). Reloading the Dashboard…`);
      setParsed(null);
      // Settings and the older saved-layout list are only read when the page loads.
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      report("Could not write to browser storage; the import may be incomplete.", true);
    }
  };

  const { backup } = parsed ?? {};
  const settingsText = parsed ? describeSettings(parsed) : "";
  const nothingSelected = !selection.paneLayoutPresets && !selection.layoutPresets && !selection.settings;

  return <section aria-label="Backup and restore" className="mt-4 pt-3 border-top">
    <Form.Label as="div" className="fw-bold">Backup &amp; restore</Form.Label>
    <p className="small mb-2">
      Layouts are stored in this browser only and are lost if you clear its site data. Export them to a file
      to keep a backup or to copy them to another device.
    </p>
    <div className="d-flex gap-2 flex-wrap">
      <Button size="sm" variant="outline-secondary" onClick={exportBackup}>
        <FontAwesomeIcon icon={faFileExport} /> Export layouts
      </Button>
      <Button size="sm" variant="outline-secondary" onClick={() => fileInput.current?.click()}>
        <FontAwesomeIcon icon={faFileImport} /> Import layouts…
      </Button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Layout backup file"
        onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
    {parsed && backup && <div className="mt-3">
      <p className="small mb-2">
        <strong>{fileName}</strong>
        {backup.exportedAt && ` — exported ${new Date(backup.exportedAt).toLocaleString()}`}
        {parsed.skipped > 0 && ` — ${parsed.skipped} invalid item${parsed.skipped === 1 ? "" : "s"} will be ignored`}
      </p>
      <Form.Check id="import-pane-presets" type="checkbox" disabled={!backup.paneLayoutPresets.length}
        label={`Saved pane layouts (${backup.paneLayoutPresets.length})`}
        checked={selection.paneLayoutPresets}
        onChange={event => setSelection(current => ({ ...current, paneLayoutPresets: event.target.checked }))} />
      <Form.Check id="import-layout-presets" type="checkbox" disabled={!backup.layoutPresets.length}
        label={`Saved dashboard layouts (${backup.layoutPresets.length})`}
        checked={selection.layoutPresets}
        onChange={event => setSelection(current => ({ ...current, layoutPresets: event.target.checked }))} />
      <Form.Check id="import-settings" type="checkbox" disabled={!hasSettings(backup.settings)}
        label={`This device's current settings${settingsText ? ` (${settingsText})` : " (none in file)"}`}
        checked={selection.settings}
        onChange={event => setSelection(current => ({ ...current, settings: event.target.checked }))} />
      <p className="small mt-1 mb-2">
        Layouts with the same name are replaced. Current settings overwrite this device's, so leave that
        unchecked when importing from a different device.
      </p>
      <div className="d-flex gap-2">
        <Button size="sm" disabled={nothingSelected} onClick={importBackup}>Import</Button>
        <Button size="sm" variant="outline-secondary" onClick={() => { setParsed(null); report(""); }}>Cancel</Button>
      </div>
    </div>}
    <div role="status" className={`small mt-2${isError ? " text-danger" : ""}`}>{message}</div>
  </section>;
};

export default LayoutBackupControls;
