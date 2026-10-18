import { useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faArrowLeft, faCheck, faGamepad, faKeyboard, faSun, faSliders } from "@fortawesome/free-solid-svg-icons";
import { Button } from "react-bootstrap";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { themeActions, DashboardTheme } from "../store/themeSlice";
import { accentActions } from "../store/accentSlice";
import { ACCENT_PRESET_ORDER, ACCENT_PRESETS } from "../theme/accentPresets";
import { uiActions } from "../store/uiSlice";
import { nextTabIndex } from "../utils/tabNav";
import GamepadSettings from "../components/GamepadSettings";
import JogPresetSettings from "../components/JogPresetSettings";
import KeyboardSettings from "../components/KeyboardSettings";
import "./SettingsPage.scss";

const THEME_OPTIONS: { value: DashboardTheme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

// Add a tab here (and a branch in the panel below) to grow the page.
const TABS: { id: string; label: string; icon: IconDefinition }[] = [
  { id: "appearance", label: "Appearance", icon: faSun },
  { id: "jog", label: "Jog presets", icon: faSliders },
  { id: "keyboard", label: "Keyboard", icon: faKeyboard },
  { id: "gamepad", label: "Game controller", icon: faGamepad },
];

const TAB_STORAGE_KEY = "ugs-dashboard-settings-tab";

const readSavedTab = (): string => {
  try {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (saved && TABS.some((tab) => tab.id === saved)) return saved;
  } catch {
    // Not remembering the tab is fine.
  }
  return TABS[0].id;
};

const AppearanceSettings = () => {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.theme.theme);
  const accent = useAppSelector((state) => state.accent.accent);

  return (
    <section className="settingsCard" aria-labelledby="appearance-heading">
      <div className="settingsCardHeading">
        <div className="settingsCardIcon"><FontAwesomeIcon icon={faSun} /></div>
        <div>
          <h2 id="appearance-heading">Appearance</h2>
          <p>Choose how UGS Dashboard looks on this device.</p>
        </div>
      </div>

      <div className="settingsFieldGrid">
        <div className="settingsField" role="group" aria-label="Color theme">
          <span className="settingsFieldLabel">Color theme</span>
          <div className="themeSwatchRow">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="themeSwatch"
                data-theme-preview={option.value}
                aria-pressed={theme === option.value}
                onClick={() => dispatch(themeActions.setTheme(option.value))}
              >
                <span className="themeSwatchPreview">
                  <span className="themeSwatchPreviewBar" />
                  <span
                    className="themeSwatchPreviewAccent"
                    style={{ background: ACCENT_PRESETS[accent][option.value].accent }}
                  />
                </span>
                <span className="themeSwatchLabel">
                  {option.label}
                  {theme === option.value && <FontAwesomeIcon icon={faCheck} />}
                </span>
              </button>
            ))}
          </div>
          <p className="settingsFieldHint">Theme changes are saved automatically for this device.</p>
        </div>

        <div className="settingsField" role="group" aria-label="Accent color">
          <span className="settingsFieldLabel">Accent color</span>
          <div className="accentSwatchRow">
            {ACCENT_PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                className="accentSwatch"
                aria-pressed={accent === preset}
                aria-label={ACCENT_PRESETS[preset].label}
                title={ACCENT_PRESETS[preset].label}
                onClick={() => dispatch(accentActions.setAccent(preset))}
              >
                <span
                  className="accentSwatchDot"
                  style={{ background: ACCENT_PRESETS[preset][theme].accent }}
                >
                  {accent === preset && <FontAwesomeIcon icon={faCheck} />}
                </span>
              </button>
            ))}
          </div>
          <p className="settingsFieldHint">Applies to both themes - each color adjusts for light or dark.</p>
        </div>
      </div>
    </section>
  );
};

const SettingsPage = () => {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState(readSavedTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectTab = (id: string) => {
    setActiveTab(id);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, id);
    } catch {
      // Not remembering the tab is fine.
    }
  };

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(TABS.length, index, event.key);
    if (next === null) return;
    event.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <main className="settingsPage">
      <div className="settingsPageHeader">
        <div>
          <p className="settingsPageEyebrow">Dashboard</p>
          <h1>Settings</h1>
          <p className="settingsPageIntro">Customize the dashboard appearance and behavior.</p>
        </div>
        <Button variant="secondary" onClick={() => dispatch(uiActions.setActivePage("dashboard"))}>
          <FontAwesomeIcon icon={faArrowLeft} />
          <span>Back to dashboard</span>
        </Button>
      </div>

      <div className="settingsTabs" role="tablist" aria-label="Settings sections">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            className="settingsTab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            <FontAwesomeIcon icon={tab.icon} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        className="settingsPanel"
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        {activeTab === "appearance" && <AppearanceSettings />}
        {activeTab === "jog" && <JogPresetSettings />}
        {activeTab === "keyboard" && <KeyboardSettings />}
        {activeTab === "gamepad" && <GamepadSettings />}
      </div>
    </main>
  );
};

export default SettingsPage;
