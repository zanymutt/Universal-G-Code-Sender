import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCompress,
  faExpand,
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
  faPlugCircleXmark,
  faRefresh,
} from "@fortawesome/free-solid-svg-icons";
import { Button } from "react-bootstrap";
import { useAppSelector } from "../hooks/useAppSelector";
import { useFullscreen } from "../hooks/useFullscreen";
import { useZoomLevel } from "../hooks/useZoomLevel";
import { disconnect, softReset } from "../services/machine";
import AccessoryState from "./AccessoryState";
import ConnectionWidget from "./ConnectionWidget";
import ConnectionHealth from "./ConnectionHealth";
import DashboardSizing from "./DashboardSizing";
import PaneLayoutPresets from "./PaneLayoutPresets";
import "./TopBar.scss";

const TopBar = () => {
  const status = useAppSelector((state) => state.status);
  const isDisconnected = status.state === "DISCONNECTED";
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const { zoom, zoomIn, zoomOut, resetZoom, applyZoom, canZoomIn, canZoomOut } = useZoomLevel();

  return (
    <div className={"topBar" + (isDisconnected ? " topBarDisconnected" : "")}>
      <div className="topBarSection">
        <ConnectionWidget />
        <ConnectionHealth />
        {status?.pins?.cycleStart && <AccessoryState title="Cycle start">C</AccessoryState>}
        {status?.pins?.hold && <AccessoryState title="HOLD">H</AccessoryState>}
        {status?.pins?.door && <AccessoryState title="Door">D</AccessoryState>}
      </div>

      <div className="topBarSection">
        <DashboardSizing zoom={zoom} resetZoom={resetZoom} applyZoom={applyZoom} />
        <PaneLayoutPresets />
        <Button variant="secondary" disabled={!canZoomOut} onClick={zoomOut} title="Zoom out">
          <FontAwesomeIcon icon={faMagnifyingGlassMinus} />
        </Button>
        <span className="topBarZoomLevel">{zoom}%</span>
        <Button variant="secondary" disabled={!canZoomIn} onClick={zoomIn} title="Zoom in">
          <FontAwesomeIcon icon={faMagnifyingGlassPlus} />
        </Button>
        <Button
          variant="secondary"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit full screen" : "Full screen"}
        >
          <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
        </Button>
        <Button variant="warning" disabled={isDisconnected} onClick={() => softReset()} title="Soft reset">
          <FontAwesomeIcon icon={faRefresh} />
        </Button>
        <Button variant="danger" disabled={isDisconnected} onClick={() => disconnect()} title="Disconnect">
          <FontAwesomeIcon icon={faPlugCircleXmark} />
        </Button>
      </div>
    </div>
  );
};

export default TopBar;
