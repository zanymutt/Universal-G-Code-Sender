import { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGamepad } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { hasGamepadApi, recalibrateGamepads, subscribeGamepads } from "../services/gamepadPoller";
import { keyBindingsActions } from "../store/keyBindingsSlice";
import { ACTIVATION_RANGE, axisThresholds, DEADBAND_RANGE, DEFAULT_PAD_TUNING, PadSnapshot } from "../utils/gamepadInput";
import AxisMonitor from "./AxisMonitor";
import BindingEditor from "./BindingEditor";
import InputBackupControls from "./InputBackupControls";
import "./KeyboardSettings.scss";

// The controllers the page can see, re-rendered only when one connects,
// disconnects or changes shape. What is being pressed is deliberately not part
// of this: a line that came and went with every button press made the whole
// page jump. The axes and analog buttons panel shows that, in a fixed layout.
const usePadsSeen = (): PadSnapshot[] => {
  const [pads, setPads] = useState<PadSnapshot[]>([]);
  useEffect(() => {
    let lastKey = "";
    return subscribeGamepads(({ pads: current }) => {
      const key = current
        .map((pad) => `${pad.index}:${pad.id}:${pad.mapping}:${pad.buttons.length}:${pad.axes.length}`)
        .join("|");
      if (key === lastKey) return;
      lastKey = key;
      setPads(current);
    });
  }, []);
  return pads;
};

const GamepadSettings = () => {
  const dispatch = useAppDispatch();
  const { gamepadEnabled, gamepadWhenUnfocused, holdToJog } = useAppSelector((state) => state.keyBindings);
  const pads = usePadsSeen();
  const [showMonitor, setShowMonitor] = useState(false);
  const api = hasGamepadApi();
  const { padTuning } = useAppSelector((state) => state.keyBindings);
  const { press, release } = axisThresholds(padTuning);
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <section className="settingsCard" aria-labelledby="gamepad-heading">
      <div className="settingsCardHeading">
        <div className="settingsCardIcon"><FontAwesomeIcon icon={faGamepad} /></div>
        <div>
          <h2 id="gamepad-heading">Game controller</h2>
          <p>
            Use a joystick or gamepad plugged into, or paired with, the device showing this dashboard. Saved on this
            device only. Inputs are bound to the same actions as the keyboard.
          </p>
        </div>
      </div>

      <Form.Check
        type="switch"
        id="gamepad-enabled"
        className="keyboardEnable"
        label="Enable the game controller on this device"
        checked={gamepadEnabled}
        onChange={(event) => dispatch(keyBindingsActions.setGamepadEnabled(event.target.checked))}
      />
      <Form.Check
        type="switch"
        id="gamepad-when-unfocused"
        className="keyboardEnable"
        label="Also respond while this window is not in front"
        checked={gamepadWhenUnfocused}
        onChange={(event) => dispatch(keyBindingsActions.setGamepadWhenUnfocused(event.target.checked))}
      />
      <p className="settingsFieldHint">
        Off by default: the browser keeps reading the controller even while you are in another application, so
        without this the dashboard only acts on it while this window has the focus. Turn it on only if you
        want the controller to jog the machine from behind other windows.
      </p>
      <Form.Check
        type="switch"
        id="gamepad-hold-to-jog"
        className="keyboardEnable"
        label="Holding a jog input keeps jogging until it is released"
        checked={holdToJog}
        onChange={(event) => dispatch(keyBindingsActions.setHoldToJog(event.target.checked))}
      />
      <p className="settingsFieldHint">
        The same setting as on the Keyboard tab. A tap is one step; held for a quarter of a second it moves
        continuously. Sticks and triggers act as buttons here, using the two settings below.
      </p>

      <div className="padTuning">
        <h3>Stick and trigger feel</h3>
        <div className="padTuningRow">
          <label htmlFor="pad-activation">
            Activation point <strong>{percent(padTuning.activation)}</strong>
            <span className="keyBindingNone"> - how far from rest it must move to count as pressed</span>
          </label>
          <Form.Range
            id="pad-activation"
            min={ACTIVATION_RANGE.min * 100}
            max={ACTIVATION_RANGE.max * 100}
            step={5}
            value={Math.round(padTuning.activation * 100)}
            onChange={(event) => dispatch(keyBindingsActions.setPadTuning({ activation: Number(event.target.value) / 100 }))}
          />
        </div>
        <div className="padTuningRow">
          <label htmlFor="pad-deadband">
            Dead band <strong>{percent(padTuning.deadband)}</strong>
            <span className="keyBindingNone"> - how close to rest it must come back to count as released</span>
          </label>
          <Form.Range
            id="pad-deadband"
            min={DEADBAND_RANGE.min * 100}
            max={DEADBAND_RANGE.max * 100}
            step={5}
            value={Math.round(padTuning.deadband * 100)}
            onChange={(event) => dispatch(keyBindingsActions.setPadTuning({ deadband: Number(event.target.value) / 100 }))}
          />
        </div>
        <p className="settingsFieldHint">
          A lower activation point is more sensitive. A larger dead band is more forgiving of a stick that does not
          return exactly to centre, but makes a held direction release later. It is always kept below the
          activation point, so with these values an axis presses at {percent(press)} and releases at {percent(release)}.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => dispatch(keyBindingsActions.setPadTuning({ ...DEFAULT_PAD_TUNING }))}
        >
          Reset to defaults
        </Button>
      </div>

      <div className="gamepadStatus" role="status">
        <h3>Controllers seen</h3>
        {!api && (
          <p className="keyBindingNone">
            This browser does not offer the Gamepad API on this address, so controllers cannot be used here.
          </p>
        )}
        {api && pads.length === 0 && (
          <p className="keyBindingNone">
            None yet. Press a button on the controller while this window is in front.
          </p>
        )}
        {pads.map((pad) => (
          <p key={pad.index} className="gamepadPad">
            <strong>{pad.id}</strong>
            <span>
              {" "}
              — {pad.buttons.length} buttons, {pad.axes.length} axes, mapping{" "}
              {pad.mapping ? pad.mapping : "not standard (learn each input with the binder below)"}
            </span>
          </p>
        ))}
        <Button variant="secondary" size="sm" onClick={() => recalibrateGamepads()}>
          Recalibrate rest positions
        </Button>
        <span className="keyBindingNone"> Hands off the sticks and triggers, then press.</span>
        <p className="padMonitorToggle">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={showMonitor}
            aria-controls="pad-monitor"
            onClick={() => setShowMonitor((open) => !open)}
          >
            {showMonitor ? "▾ Hide" : "▸ Show"} all axes and analog buttons
          </Button>
        </p>
        {showMonitor && <AxisMonitor />}
      </div>

      <BindingEditor kind="pad" />
      <InputBackupControls />
    </section>
  );
};

export default GamepadSettings;
