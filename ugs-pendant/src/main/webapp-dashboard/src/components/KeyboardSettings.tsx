import { useEffect, useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKeyboard, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { keyBindingsActions } from "../store/keyBindingsSlice";
import { fetchMacros } from "../store/macrosSlice";
import { ACTION_GROUPS, ACTIONS, macroActionId } from "../utils/dashboardActions";
import { assignCombo, comboFromEvent, formatCombo } from "../utils/keyBindings";
import "./KeyboardSettings.scss";

const MODIFIER_ONLY = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;

type Row = { id: string; label: string };

const KeyboardSettings = () => {
  const dispatch = useAppDispatch();
  const { enabled, bindings } = useAppSelector((state) => state.keyBindings);
  const macros = useAppSelector((state) => state.macros.macros);
  const macrosLoaded = useAppSelector((state) => state.macros.loaded);
  // The action currently waiting for a key press, and a one-line result.
  const [capturing, setCapturing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const labels = new Map<string, string>();
  ACTIONS.forEach((action) => labels.set(action.id, action.label));
  macros.forEach((macro) => labels.set(macroActionId(macro.uuid), `Macro: ${macro.name}`));

  useEffect(() => {
    if (!macrosLoaded) dispatch(fetchMacros());
  }, [dispatch, macrosLoaded]);

  // While waiting for a key this swallows every key press before the rest of
  // the page (and the shortcut layer) can see it, so pressing the key you are
  // binding never also jogs the machine or types into something.
  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        setCapturing(null);
        return;
      }
      if (MODIFIER_ONLY.test(event.code)) return;
      const combo = comboFromEvent(event);
      if (!combo) {
        setNotice("That key can't be used for a shortcut.");
        return;
      }
      const { displaced } = assignCombo(bindingsRef.current, capturing, combo);
      dispatch(keyBindingsActions.assign({ actionId: capturing, combo }));
      setNotice(
        displaced
          ? `${formatCombo(combo)} was moved from "${labels.get(displaced) ?? displaced}".`
          : `${formatCombo(combo)} assigned.`
      );
      setCapturing(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // `labels` is rebuilt every render; it only feeds a message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, dispatch]);

  const renderRow = ({ id, label }: Row) => {
    const combos = bindings[id] ?? [];
    const isCapturing = capturing === id;
    return (
      <div className="keyBindingRow" key={id}>
        <span className="keyBindingLabel">{label}</span>
        <span className="keyBindingCombos">
          {combos.length === 0 && <span className="keyBindingNone">Not set</span>}
          {combos.map((combo) => (
            <span className="keyChip" key={combo}>
              <kbd>{formatCombo(combo)}</kbd>
              <button
                type="button"
                className="keyChipRemove"
                aria-label={`Remove ${formatCombo(combo)} from ${label}`}
                title="Remove"
                onClick={() => dispatch(keyBindingsActions.remove({ actionId: id, combo }))}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </span>
          ))}
        </span>
        <Button
          size="sm"
          variant={isCapturing ? "warning" : "secondary"}
          className="keyBindingAdd"
          onClick={() => {
            setNotice(null);
            setCapturing(isCapturing ? null : id);
          }}
        >
          {isCapturing ? "Press a key… (Esc cancels)" : "Add key"}
        </Button>
      </div>
    );
  };

  return (
    <section className="settingsCard" aria-labelledby="keyboard-heading">
      <div className="settingsCardHeading">
        <div className="settingsCardIcon"><FontAwesomeIcon icon={faKeyboard} /></div>
        <div>
          <h2 id="keyboard-heading">Keyboard shortcuts</h2>
          <p>Drive jogging, the job and the machine from a keyboard or a Bluetooth keypad. Saved on this device only.</p>
        </div>
      </div>

      <Form.Check
        type="switch"
        id="keyboard-shortcuts-enabled"
        className="keyboardEnable"
        label="Enable keyboard shortcuts on this device"
        checked={enabled}
        onChange={(event) => dispatch(keyBindingsActions.setEnabled(event.target.checked))}
      />
      <p className="settingsFieldHint">
        Active only on the dashboard page, never while typing in a field or the editor, and not while a dialog is open.
        Holding a key does not repeat. Jog keys move the machine - keep the area clear. Keys pressed while a plugin
        window has focus are not seen by the dashboard.
      </p>

      <div className="keyBindingsToolbar">
        <Button variant="secondary" size="sm" onClick={() => dispatch(keyBindingsActions.resetBindings())}>
          Reset keys to defaults
        </Button>
        <span className="keyBindingsNotice" role="status">{notice}</span>
      </div>

      <div className="keyBindingGroups">
      {ACTION_GROUPS.map((group) => (
        <div className="keyBindingGroup" key={group}>
          <h3>{group}</h3>
          {ACTIONS.filter((action) => action.group === group).map((action) =>
            renderRow({ id: action.id, label: action.label })
          )}
        </div>
      ))}

      <div className="keyBindingGroup">
        <h3>Macros</h3>
        {macros.length === 0 && <p className="keyBindingNone">No macros configured in UGS.</p>}
        {macros.map((macro) => renderRow({ id: macroActionId(macro.uuid), label: macro.name }))}
      </div>
      </div>
    </section>
  );
};

export default KeyboardSettings;
