import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, InputGroup } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../hooks/useAppSelector";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useConsoleFontSize } from "../hooks/useConsoleFontSize";
import { consoleActions } from "../store/consoleSlice";
import { sendGcode } from "../services/machine";
import "./ConsolePanel.scss";

const ConsolePanel = () => {
  const dispatch = useAppDispatch();
  const currentState = useAppSelector((state) => state.status.state);
  const verboseEnabled = useAppSelector((state) => state.console.verboseEnabled);
  // Owned here now (rather than passed down from CenterPanel) since both the
  // +/- control and the text itself live entirely inside this component -
  // there's only ever one ConsolePanel instance, so there's no risk of two
  // separate hook instances drifting apart on the shared localStorage key.
  const {
    fontSize,
    increase: increaseFontSize,
    decrease: decreaseFontSize,
    canIncrease: canIncreaseFontSize,
    canDecrease: canDecreaseFontSize,
  } = useConsoleFontSize();
  const [gcodeCommand, setGcodeCommand] = useState("");
  const messages = useAppSelector((state) => state.console.messages);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  const isEnabled = useMemo(
    () => currentState === "IDLE" || currentState === "JOG",
    [currentState],
  );

  useEffect(() => {
    const el = consoleRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSendGcode = () => {
    if (isEnabled && gcodeCommand.trim()) {
      sendGcode(gcodeCommand.trim()).then(() => {
        setGcodeCommand("");
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSendGcode();
    }
  };

  return (
    <div className="consolePanel">
      <div className="console" ref={consoleRef} style={{ fontSize: `${fontSize}px` }}>
        {messages.length === 0 ? (
          <div style={{ color: "#888" }}>
            Controller console output will appear here.
          </div>
        ) : (
          messages.map((line) => (
            <div
              key={line.id}
              style={{
                color:
                  line.type === "error"
                    ? "#ff6b6b"
                    : line.type === "ok"
                      ? "#7bdcff"
                      : line.type === "verbose"
                        ? "#6b7280"
                        : "#ddd",
              }}
            >
              {line.text}
            </div>
          ))
        )}
      </div>

      <div className="consoleInput">
        <InputGroup>
          {/* Deliberately never `disabled` - a disabled input forces the browser to
              blur it, which was kicking focus out of the console the moment a sent
              command changed the controller state (e.g. any real motion). Typing/
              queuing a command ahead of time is harmless; only actually sending is
              gated on isEnabled, in handleSendGcode and the Send button below. */}
          <Form.Control
            id="gcode-command-input"
            type="text"
            placeholder="e.g., G0 X0 Y0 Z-100"
            value={gcodeCommand}
            onChange={(e) => setGcodeCommand(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            variant="primary"
            onClick={handleSendGcode}
            disabled={!isEnabled || !gcodeCommand.trim()}
          >
            Send
          </Button>
        </InputGroup>

        {/* Verbose and the text-size control live here, right of Send,
            rather than in a header above - that header disappears/moves
            around depending on split state, while this row is always
            exactly where the console itself is. */}
        <Form.Check
          type="switch"
          id="verbose-toggle"
          label="Verbose"
          checked={verboseEnabled}
          // Gated server-side too (EventsSocket.java only forwards
          // MessageType.VERBOSE traffic to sessions that asked for it) -
          // toggling this off actually stops the extra traffic at the
          // source, not just hides it here.
          onChange={(e) => dispatch(consoleActions.setVerboseEnabled(e.target.checked))}
          className="consoleVerboseToggle"
        />

        <div className="consoleFontSize" title="Console text size">
          <Button variant="secondary" size="sm" disabled={!canDecreaseFontSize} onClick={decreaseFontSize} title="Smaller text">
            <FontAwesomeIcon icon={faMinus} />
          </Button>
          <span className="consoleFontSizeValue">{fontSize}px</span>
          <Button variant="secondary" size="sm" disabled={!canIncreaseFontSize} onClick={increaseFontSize} title="Larger text">
            <FontAwesomeIcon icon={faPlus} />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConsolePanel;
