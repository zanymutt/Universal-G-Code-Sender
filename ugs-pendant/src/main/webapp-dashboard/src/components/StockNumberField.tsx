import { useEffect, useState } from "react";
import { Form } from "react-bootstrap";

// Keeps its own text while typing so clearing the box to retype doesn't fight
// the committed value; only valid numbers within range are committed upward.
const StockNumberField = ({
  label,
  value,
  min,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Form.Group className="stockSettingsField">
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next) && next >= min) onChange(next);
        }}
      />
      {hint && <div className="stockSettingsHint">{hint}</div>}
    </Form.Group>
  );
};

export default StockNumberField;
