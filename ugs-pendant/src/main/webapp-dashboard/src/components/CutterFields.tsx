import { Form } from "react-bootstrap";
import { CutterSpec, StockShape } from "../utils/stockSimEngine";
import NumberField from "./StockNumberField";

type Props = {
  cutter: CutterSpec;
  onChange: (patch: Partial<CutterSpec>) => void;
  // Gives each select a distinct accessible name when several are on screen.
  label?: string;
};

// The router cutter's profile: shape plus the numbers that shape needs. Used for
// the default cutter and for each row of the tool table.
const CutterFields = ({ cutter, onChange, label }: Props) => {
  const prefix = label ? `${label}: ` : "";
  return (
    <>
      <Form.Group>
        <Form.Label>Cutter shape</Form.Label>
        <Form.Select
          aria-label={`${prefix}Cutter shape`}
          value={cutter.shape}
          onChange={(event) => {
            const shape = event.target.value as StockShape;
            // A taper ball needs a tip ball; a zero tip would just be a sharp cone.
            onChange(shape === "taperball" && cutter.tipDiameter === 0 ? { shape, tipDiameter: 1 } : { shape });
          }}
        >
          <option value="flat">Flat end mill</option>
          <option value="ball">Ball nose</option>
          <option value="bullnose">Bull nose (corner radius)</option>
          <option value="v">V-bit / chamfer</option>
          <option value="taperball">Taper ball nose</option>
        </Form.Select>
      </Form.Group>
      <NumberField
        label="Cutter diameter (mm)"
        value={cutter.diameter}
        min={0.01}
        step={0.5}
        onChange={(diameter) => onChange({ diameter })}
      />
      {cutter.shape === "bullnose" && (
        <NumberField
          label="Corner radius (mm)"
          value={cutter.cornerRadius}
          min={0}
          step={0.25}
          hint="0 is a flat end mill; half the diameter is a ball nose."
          onChange={(cornerRadius) => onChange({ cornerRadius })}
        />
      )}
      {(cutter.shape === "v" || cutter.shape === "taperball") && (
        <NumberField
          label={cutter.shape === "v" ? "V-bit included angle (deg)" : "Taper included angle (deg)"}
          value={cutter.vAngle}
          min={10}
          step={5}
          onChange={(vAngle) => onChange({ vAngle })}
        />
      )}
      {(cutter.shape === "v" || cutter.shape === "taperball") && (
        <NumberField
          label={cutter.shape === "v" ? "Tip flat diameter (mm)" : "Tip ball diameter (mm)"}
          value={cutter.tipDiameter}
          min={0}
          step={0.1}
          hint={
            cutter.shape === "v"
              ? "0 is a sharp point; a flat tip makes a chamfer bit."
              : "The ball at the end of the tapered cutter."
          }
          onChange={(tipDiameter) => onChange({ tipDiameter })}
        />
      )}
    </>
  );
};

export default CutterFields;
