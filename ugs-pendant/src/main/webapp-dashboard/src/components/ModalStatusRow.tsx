import { Dropdown } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../hooks/useAppSelector";
import { sendGcode } from "../services/machine";
import "./ModalStatusRow.scss";

// Fixed set (not fetched from the backend) - the 9 work coordinate systems
// are a permanent part of the gcode standard (LinuxCNC/GRBL/FluidNC all
// agree on exactly these), not something that varies by firmware or config.
const WCS_OPTIONS = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

// Mirrors the modal-state row FluidNC's own WebUI shows (e.g. "G0 G54 G21
// G90 G94 G17 M5 T0"), restyled to this dashboard's own theme instead of
// copying that one - the G54 badge doubles as this dashboard's WCS selector,
// the rest are read-only chips reflecting whatever the controller last
// reported (see StatusResource.getStatus/GcodeState on the Java side).
const ModalStatusRow = () => {
  const status = useAppSelector((state) => state.status);
  const isDisconnected = status.state === "DISCONNECTED";
  // Same gate as AxisRow's zero button - changing the active work
  // coordinate system (or any other modal state) mid-job or mid-motion
  // isn't safe, only while genuinely idle.
  const canAdjust = status.state === "IDLE";

  if (isDisconnected) {
    return <></>;
  }

  const currentWcs = status.coordinateSystem || "G54";

  return (
    <div className="modalStatusRow">
      {/* A plain <select>'s open option list is native OS/browser chrome -
          largely outside CSS's reach, and confirmed not visibly marking
          the current selection at all in this dark theme (the browser's
          own default "selected" treatment wasn't visible against it). A
          react-bootstrap Dropdown instead renders its menu as ordinary
          page content, so every part of it - including an explicit
          checkmark on the active entry, not just relying on Bootstrap's
          own .active styling - is guaranteed to render exactly as styled. */}
      <Dropdown className="modalStatusWcs" onSelect={(wcs) => wcs && sendGcode(wcs)}>
        <Dropdown.Toggle
          id="modal-status-wcs-toggle"
          disabled={!canAdjust}
          title="Active work coordinate system"
        >
          <span className="modalStatusWcsLabel">{currentWcs}</span>
          <FontAwesomeIcon icon={faChevronDown} className="modalStatusWcsCaret" />
        </Dropdown.Toggle>
        <Dropdown.Menu>
          {WCS_OPTIONS.map((wcs) => (
            <Dropdown.Item key={wcs} eventKey={wcs} active={wcs === currentWcs}>
              <FontAwesomeIcon icon={faCheck} className="modalStatusWcsCheck" />
              {wcs}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown>

      {[status.motionMode, status.units, status.distanceMode, status.feedMode, status.plane, status.spindleMode]
        .filter(Boolean)
        .map((code) => (
          <span className="modalStatusChip" key={code}>
            {code}
          </span>
        ))}
      <span className="modalStatusChip">T{status.toolNumber ?? 0}</span>
    </div>
  );
};

export default ModalStatusRow;
