import { useState } from "react";
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen } from "@fortawesome/free-solid-svg-icons";
import Toolbox from "./Toolbox";
import MacrosPanel from "./MacrosPanel";
import SpindleCoolantControls from "./SpindleCoolantControls";
import OverrideControls from "./OverrideControls";
import PluginListPanel from "./PluginListPanel";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { uiActions } from "../store/uiSlice";
import { SHOW_PANE_CONTENT_EVENT } from "./CenterPaneLayoutDemo";
import "./RightRail.scss";

const RightRail = () => {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<"machine" | "overrides">("machine");

  return (
    <div className="rightRail">
      <div className="rightRailTabs" role="tablist" aria-label="Machine controls">
        <Button role="tab" id="machine-controls-tab" aria-controls="machine-controls-panel" aria-selected={tab === "machine"} variant={tab === "machine" ? "primary" : "outline-secondary"} onClick={() => setTab("machine")}>Machine / Macros</Button>
        <Button role="tab" id="overrides-tab" aria-controls="overrides-panel" aria-selected={tab === "overrides"} variant={tab === "overrides" ? "primary" : "outline-secondary"} onClick={() => setTab("overrides")}>Overrides</Button>
      </div>
      <div className="rightRailTabPanel" role="tabpanel" id="machine-controls-panel" aria-labelledby="machine-controls-tab" hidden={tab !== "machine"}>
      <div className="rightRailSection">
        <h6 className="rightRailHeading">Toolbox</h6>
        <Toolbox />
      </div>

      <div className="rightRailSection rightRailMacros">
        <div className="rightRailSectionHeader">
          <h6 className="rightRailHeading">Macros</h6>
          <Button
            size="sm"
            variant="outline-secondary"
            className="rightRailEditButton"
            title="Edit macros"
            onClick={() => {
              // setCenterView still drives the old CenterPanel (only reachable
              // via ?legacyLayout=1 - see CenterPanel.tsx); the window event
              // is what the current pane-layout system actually listens for.
              dispatch(uiActions.setCenterView("macros"));
              window.dispatchEvent(new CustomEvent(SHOW_PANE_CONTENT_EVENT, { detail: { content: "macros" } }));
            }}
          >
            <FontAwesomeIcon icon={faPen} />
          </Button>
        </div>
        <MacrosPanel />
      </div>

      <div className="rightRailSection">
        <h6 className="rightRailHeading">Plugins</h6>
        <PluginListPanel />
      </div>

      <div className="rightRailSection rightRailSpindle">
        <h6 className="rightRailHeading">Spindle / Coolant</h6>
        <SpindleCoolantControls />
      </div>
      </div>
      <div className="rightRailTabPanel" role="tabpanel" id="overrides-panel" aria-labelledby="overrides-tab" hidden={tab !== "overrides"}>
        <div className="rightRailSection rightRailOverrides">
          <h6 className="rightRailHeading">Overrides</h6>
          <OverrideControls />
        </div>
      </div>
    </div>
  );
};

export default RightRail;
