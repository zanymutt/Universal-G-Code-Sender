import { useEffect, useRef, useState } from "react";
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { setInputCapturing } from "../services/inputCapture";
import { subscribeGamepads } from "../services/gamepadPoller";
import { keyBindingsActions } from "../store/keyBindingsSlice";
import { fetchMacros } from "../store/macrosSlice";
import { ACTION_GROUPS, ACTIONS, macroActionId } from "../utils/dashboardActions";
import { isPadInput } from "../utils/gamepadInput";
import { assignCombo, BindingKind, comboFromEvent, formatCombo } from "../utils/keyBindings";
import "./KeyboardSettings.scss";

const MODIFIER_ONLY = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;

type Row = { id: string; label: string };

type Props = {
  // Which inputs this editor shows and learns: the keyboard's or a controller's.
  kind: BindingKind;
};

// The action -> input table with press-to-bind, shared by the Keyboard and
// Gamepad tabs. It only ever lists and edits inputs of its own kind, so a
// controller button never shows up (or is wiped) on the keyboard tab.
const BindingEditor = ({ kind }: Props) => {
  const dispatch = useAppDispatch();
  const { bindings } = useAppSelector((state) => state.keyBindings);
  const macros = useAppSelector((state) => state.macros.macros);
  const macrosLoaded = useAppSelector((state) => state.macros.loaded);
  // The action currently waiting for an input, and a one-line result.
  const [capturing, setCapturing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const labels = new Map<string, string>();
  ACTIONS.forEach((action) => labels.set(action.id, action.label));
  macros.forEach((macro) => labels.set(macroActionId(macro.uuid), `Macro: ${macro.name}`));
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const isMine = (combo: string) => isPadInput(combo) === (kind === "pad");

  useEffect(() => {
    if (!macrosLoaded) dispatch(fetchMacros());
  }, [dispatch, macrosLoaded]);

  const assign = (actionId: string, combo: string) => {
    const { displaced } = assignCombo(bindingsRef.current, actionId, combo);
    dispatch(keyBindingsActions.assign({ actionId, combo }));
    setNotice(
      displaced
        ? `${formatCombo(combo)} was moved from "${labelsRef.current.get(displaced) ?? displaced}".`
        : `${formatCombo(combo)} assigned.`
    );
    setCapturing(null);
  };

  // Keyboard: while waiting this swallows every key press before the rest of the
  // page (and the shortcut layer) can see it, so pressing the key you are
  // binding never also jogs the machine or types into something.
  useEffect(() => {
    if (!capturing || kind !== "keyboard") return;
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
      assign(capturing, combo);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, kind]);

  // Controller: the first input that goes down is the one. Whatever was already
  // held when waiting began must come back up first, so the press that clicked
  // "Add input" with the stick still deflected isn't taken as the answer.
  useEffect(() => {
    if (!capturing || kind !== "pad") return;
    setInputCapturing(true);
    let alreadyHeld: Set<string> | null = null;
    const unsubscribe = subscribeGamepads(({ active }) => {
      if (alreadyHeld === null) {
        alreadyHeld = new Set(active);
        return;
      }
      alreadyHeld.forEach((input) => {
        if (!active.has(input)) alreadyHeld!.delete(input);
      });
      for (const input of active) {
        if (!alreadyHeld.has(input)) {
          assign(capturing, input);
          return;
        }
      }
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") setCapturing(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
      setInputCapturing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, kind]);

  const renderRow = ({ id, label }: Row) => {
    const combos = (bindings[id] ?? []).filter(isMine);
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
          {isCapturing
            ? kind === "keyboard"
              ? "Press a key… (Esc cancels)"
              : "Press a button or move a stick… (Esc cancels)"
            : kind === "keyboard"
              ? "Add key"
              : "Add input"}
        </Button>
      </div>
    );
  };

  return (
    <>
      <div className="keyBindingsToolbar">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => dispatch(keyBindingsActions.resetBindings({ kind }))}
        >
          {kind === "keyboard" ? "Reset keys to defaults" : "Clear all controller bindings"}
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
    </>
  );
};

export default BindingEditor;
