import { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGamepad } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { hasGamepadApi, recalibrateGamepads, subscribeGamepads } from "../services/gamepadPoller";
import { keyBindingsActions } from "../store/keyBindingsSlice";
import { describeInput, PadSnapshot } from "../utils/gamepadInput";
import BindingEditor from "./BindingEditor";
import "./KeyboardSettings.scss";

type Seen = { pads: PadSnapshot[]; active: string[] };

// What the page can see right now, re-rendered only when it changes (the read
// loop runs every animation frame).
const useGamepadsSeen = (): Seen => {
  const [seen, setSeen] = useState<Seen>({ pads: [], active: [] });
  useEffect(() => {
    let lastKey = "";
    return subscribeGamepads(({ pads, active }) => {
      const list = [...active].sort();
      const key = pads.map((pad) => `${pad.index}:${pad.id}:${pad.mapping}:${pad.buttons.length}:${pad.axes.length}`).join("|") + "#" + list.join(",");
      if (key === lastKey) return;
      lastKey = key;
      setSeen({ pads, active: list });
    });
  }, []);
  return seen;
};

const GamepadSettings = () => {
  const dispatch = useAppDispatch();
  const { gamepadEnabled, gamepadWhenUnfocused, holdToJog } = useAppSelector((state) => state.keyBindings);
  const { pads, active } = useGamepadsSeen();
  const api = hasGamepadApi();

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
        continuously. Sticks and triggers act as buttons here: past about half way is "pressed".
      </p>

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
        <p>
          <span className="keyBindingNone">Held now: </span>
          {active.length === 0 && <span className="keyBindingNone">nothing</span>}
          {active.map((input) => (
            <span className="keyChip" key={input}>
              <kbd>{describeInput(input)}</kbd>
            </span>
          ))}
        </p>
        <Button variant="secondary" size="sm" onClick={() => recalibrateGamepads()}>
          Recalibrate rest positions
        </Button>
        <span className="keyBindingNone"> Hands off the sticks and triggers, then press.</span>
      </div>

      <BindingEditor kind="pad" />
    </section>
  );
};

export default GamepadSettings;
