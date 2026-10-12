import { Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKeyboard } from "@fortawesome/free-solid-svg-icons";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { keyBindingsActions } from "../store/keyBindingsSlice";
import BindingEditor from "./BindingEditor";
import InputBackupControls from "./InputBackupControls";
import "./KeyboardSettings.scss";

const KeyboardSettings = () => {
  const dispatch = useAppDispatch();
  const { enabled, holdToJog } = useAppSelector((state) => state.keyBindings);

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
      <Form.Check
        type="switch"
        id="keyboard-hold-to-jog"
        className="keyboardEnable"
        label="Holding a jog key keeps jogging until it is released"
        checked={holdToJog}
        onChange={(event) => dispatch(keyBindingsActions.setHoldToJog(event.target.checked))}
      />
      <p className="settingsFieldHint">
        A tap is still one step. Held for a quarter of a second it moves continuously at the jog feed rate set on
        the dashboard, and stops when you let go, switch away from this window, or the link to UGS drops. Speed
        over Wi-Fi depends on the machine's own connection, not the tablet's. Also applies to a game controller.
      </p>
      <p className="settingsFieldHint">
        Active only on the dashboard page, never while typing in a field or the editor, and not while a dialog is open.
        Holding a key does not repeat. Jog keys move the machine - keep the area clear. Keys pressed while a plugin
        window has focus are not seen by the dashboard.
      </p>

      <BindingEditor kind="keyboard" />
      <InputBackupControls />
    </section>
  );
};

export default KeyboardSettings;
