import { useState } from "react";
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen } from "@fortawesome/free-solid-svg-icons";
import Toolbox from "./Toolbox";
import MacrosPanel from "./MacrosPanel";
import SpindleCoolantControls from "./SpindleCoolantControls";
import OverrideControls from "./OverrideControls";
import PluginsSection from "./PluginsSection";
import RailHeading from "./RailHeading";
import { useRailCollapsed } from "../hooks/useRailPrefs";
import MacroEditorModal from "./MacroEditorModal";
import "./RightRail.scss";

const RightRail = () => {
  const [tab, setTab] = useState<"machine" | "overrides">("machine");
  const [macroEditorOpen, setMacroEditorOpen] = useState(false);
  // Sections can be folded away (remembered per device) so a short screen can
  // keep just the ones it uses in view.
  const { isCollapsed, toggle } = useRailCollapsed();

  return (
    <div className="rightRail">
      <div className="rightRailTabs" role="tablist" aria-label="Machine controls">
        <Button role="tab" id="machine-controls-tab" aria-controls="machine-controls-panel" aria-selected={tab === "machine"} variant={tab === "machine" ? "primary" : "outline-secondary"} onClick={() => setTab("machine")}>Machine / Macros</Button>
        <Button role="tab" id="overrides-tab" aria-controls="overrides-panel" aria-selected={tab === "overrides"} variant={tab === "overrides" ? "primary" : "outline-secondary"} onClick={() => setTab("overrides")}>Overrides</Button>
      </div>
      <div className="rightRailTabPanel" role="tabpanel" id="machine-controls-panel" aria-labelledby="machine-controls-tab" hidden={tab !== "machine"}>
      <div className="rightRailSection">
        <RailHeading id="toolbox" title="Toolbox" collapsed={isCollapsed("toolbox")} onToggle={() => toggle("toolbox")} />
        <div id="rail-section-toolbox" hidden={isCollapsed("toolbox")}>
          <Toolbox />
        </div>
      </div>

      <div className={`rightRailSection rightRailMacros${isCollapsed("macros") ? " rightRailCollapsed" : ""}`}>
        <div className="rightRailSectionHeader">
          <RailHeading id="macros" title="Macros" collapsed={isCollapsed("macros")} onToggle={() => toggle("macros")} />
          <Button
            size="sm"
            variant="outline-secondary"
            className="rightRailEditButton"
            title="Edit macros"
            onClick={() => setMacroEditorOpen(true)}
          >
            <FontAwesomeIcon icon={faPen} />
          </Button>
        </div>
        <div id="rail-section-macros" className="rightRailMacrosBody" hidden={isCollapsed("macros")}>
          <MacrosPanel />
        </div>
      </div>

      <PluginsSection collapsed={isCollapsed("plugins")} onToggleCollapsed={() => toggle("plugins")} />

      <div className="rightRailSection rightRailSpindle">
        <RailHeading id="spindle" title="Spindle / Coolant" collapsed={isCollapsed("spindle")} onToggle={() => toggle("spindle")} />
        <div id="rail-section-spindle" hidden={isCollapsed("spindle")}>
          <SpindleCoolantControls />
        </div>
      </div>
      </div>
      <div className="rightRailTabPanel" role="tabpanel" id="overrides-panel" aria-labelledby="overrides-tab" hidden={tab !== "overrides"}>
        <div className="rightRailSection rightRailOverrides">
          <RailHeading id="overrides" title="Overrides" collapsed={isCollapsed("overrides")} onToggle={() => toggle("overrides")} />
          <div id="rail-section-overrides" hidden={isCollapsed("overrides")}>
            <OverrideControls />
          </div>
        </div>
      </div>
      <MacroEditorModal show={macroEditorOpen} onClose={() => setMacroEditorOpen(false)} />
    </div>
  );
};

export default RightRail;
