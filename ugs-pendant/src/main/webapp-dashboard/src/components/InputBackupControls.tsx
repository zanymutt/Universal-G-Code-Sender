import { useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileExport, faFileImport } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { keyBindingsActions } from "../store/keyBindingsSlice";
import { buildInputBackup, inputBackupFilename, parseInputBackup, ParsedInputBackup } from "../utils/inputBackup";
import { mergeImportedBindings } from "../utils/keyBindings";

type Selection = { keyboard: boolean; pad: boolean; tuning: boolean };

// Export / import of the key and controller bindings as one JSON file, so they
// can be backed up and copied to another computer (browser storage is per
// device, and per address). Never carries the on/off switches: importing a file
// must not turn a machine's keyboard or controller on.
const InputBackupControls = () => {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.keyBindings);
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedInputBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [selection, setSelection] = useState<Selection>({ keyboard: true, pad: true, tuning: true });
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const report = (text: string, error = false) => {
    setMessage(text);
    setIsError(error);
  };

  const exportBackup = () => {
    try {
      const blob = new Blob([JSON.stringify(buildInputBackup(settings), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = inputBackupFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(`Saved ${inputBackupFilename()} to your downloads.`);
    } catch {
      report("Could not create the backup file in this browser.", true);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setParsed(null);
    const result = parseInputBackup(await file.text().catch(() => ""));
    if (!result.ok) {
      report(result.error, true);
      return;
    }
    setFileName(file.name);
    setSelection({
      keyboard: result.value.counts.keyboard > 0,
      pad: result.value.counts.pad > 0,
      tuning: result.value.backup.padTuning !== null,
    });
    setParsed(result.value);
    report("");
  };

  const importBackup = () => {
    if (!parsed) return;
    const bindings = mergeImportedBindings(settings.bindings, parsed.backup.bindings, {
      keyboard: selection.keyboard,
      pad: selection.pad,
    });
    dispatch(
      keyBindingsActions.importInputSettings({
        bindings,
        padTuning: selection.tuning && parsed.backup.padTuning ? parsed.backup.padTuning : undefined,
      })
    );
    report("Imported. Your on/off switches were left as they are on this device.");
    setParsed(null);
  };

  const counts = parsed?.counts;
  const nothingSelected = !selection.keyboard && !selection.pad && !selection.tuning;

  return (
    <section className="inputBackup" aria-label="Backup and restore of key and controller bindings">
      <h3>Backup &amp; restore</h3>
      <p className="settingsFieldHint">
        Bindings are stored in this browser only. Export them to a file to keep a backup or to set up another
        computer. The on/off switches, the focus rule and hold-to-jog are not included, so an import can never turn
        keys or the controller on by itself.
      </p>
      <div className="inputBackupButtons">
        <Button size="sm" variant="secondary" onClick={exportBackup}>
          <FontAwesomeIcon icon={faFileExport} /> Export bindings
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
          <FontAwesomeIcon icon={faFileImport} /> Import bindings…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Bindings backup file"
          onChange={(event) => {
            void chooseFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {parsed && counts && (
        <div className="inputBackupChoice">
          <p className="settingsFieldHint">
            <strong>{fileName}</strong>
            {parsed.backup.exportedAt && ` - exported ${new Date(parsed.backup.exportedAt).toLocaleString()}`}
            {parsed.skipped > 0 && ` - ${parsed.skipped} unusable entr${parsed.skipped === 1 ? "y" : "ies"} will be ignored`}
          </p>
          <Form.Check
            id="import-keyboard-bindings"
            type="checkbox"
            disabled={counts.keyboard === 0}
            label={`Keyboard bindings (${counts.keyboard})`}
            checked={selection.keyboard}
            onChange={(event) => setSelection((current) => ({ ...current, keyboard: event.target.checked }))}
          />
          <Form.Check
            id="import-pad-bindings"
            type="checkbox"
            disabled={counts.pad === 0}
            label={`Controller bindings (${counts.pad})`}
            checked={selection.pad}
            onChange={(event) => setSelection((current) => ({ ...current, pad: event.target.checked }))}
          />
          <Form.Check
            id="import-pad-tuning"
            type="checkbox"
            disabled={parsed.backup.padTuning === null}
            label="Stick activation point and dead band"
            checked={selection.tuning}
            onChange={(event) => setSelection((current) => ({ ...current, tuning: event.target.checked }))}
          />
          <p className="settingsFieldHint">
            Each kind you import replaces that kind's bindings on this device; the other kind is untouched.
            {counts.macros > 0 &&
              ` ${counts.macros} binding${counts.macros === 1 ? " is" : "s are"} for macros, which only work if the same macros exist in this UGS.`}
            {" "}Controller bindings are tied to the controller's own button layout.
          </p>
          <div className="inputBackupButtons">
            <Button size="sm" disabled={nothingSelected} onClick={importBackup}>
              Import
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setParsed(null);
                report("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div role="status" className={`keyBindingsNotice${isError ? " inputBackupError" : ""}`}>{message}</div>
    </section>
  );
};

export default InputBackupControls;
