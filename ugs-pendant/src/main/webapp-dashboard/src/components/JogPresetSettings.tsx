import { useState } from "react";
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotateLeft, faSliders } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { jogPresetsActions } from "../store/jogPresetsSlice";
import { isValidPreset, JogPresetKind } from "../utils/jogPresets";
import "./JogPresetSettings.scss";

const ROWS: { kind: JogPresetKind; label: string; unit: (units: string) => string }[] = [
  { kind: "xy", label: "X/Y step", unit: (units) => units },
  { kind: "z", label: "Z step", unit: (units) => units },
  { kind: "feed", label: "Feed rate", unit: (units) => `${units}/min` },
];

// One slot. Typing is kept as text and only saved when it is a positive number,
// on blur or Enter; anything else snaps back to the saved value.
const PresetInput = ({ kind, index, label }: { kind: JogPresetKind; index: number; label: string }) => {
  const dispatch = useAppDispatch();
  const saved = useAppSelector((state) => state.jogPresets[kind][index]);
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && !isValidPreset(Number(draft.trim() === "" ? NaN : draft));

  const commit = () => {
    if (draft !== null) {
      const value = Number(draft.trim() === "" ? NaN : draft);
      if (isValidPreset(value) && value !== saved) dispatch(jogPresetsActions.setPreset({ kind, index, value }));
    }
    setDraft(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`jogPresetInput${invalid ? " jogPresetInvalid" : ""}`}
      aria-label={`${label}, preset ${index + 1}`}
      aria-invalid={invalid}
      value={draft ?? String(saved)}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
};

const JogPresetSettings = () => {
  const dispatch = useAppDispatch();
  const units = useAppSelector((state) => state.settings.preferredUnits).toLocaleLowerCase();

  return (
    <section className="settingsCard" aria-labelledby="jog-presets-heading">
      <div className="settingsCardHeading">
        <div className="settingsCardIcon"><FontAwesomeIcon icon={faSliders} /></div>
        <div>
          <h2 id="jog-presets-heading">Jog presets</h2>
          <p>
            The six buttons shown for X/Y step, Z step and feed rate on the Jog pad. Saved on this device only.
          </p>
        </div>
      </div>

      <div className="jogPresetRows">
        {ROWS.map(({ kind, label, unit }) => (
          <div key={kind} className="jogPresetRow" role="group" aria-label={label}>
            <span className="settingsFieldLabel">
              {label} <span className="jogPresetUnit">({unit(units)})</span>
            </span>
            <div className="jogPresetSlots">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <PresetInput key={index} kind={kind} index={index} label={label} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="settingsFieldHint">
        Type a positive number and press Enter or click away. The buttons and the keyboard / game controller
        step up and down always run smallest to largest, whatever order the slots are in.
      </p>

      <Button variant="outline-secondary" onClick={() => dispatch(jogPresetsActions.reset())}>
        <FontAwesomeIcon icon={faRotateLeft} />
        <span> Reset to defaults</span>
      </Button>
    </section>
  );
};

export default JogPresetSettings;
