import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCheck, faSun } from "@fortawesome/free-solid-svg-icons";
import { Button } from "react-bootstrap";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useAppSelector } from "../hooks/useAppSelector";
import { themeActions, DashboardTheme } from "../store/themeSlice";
import { accentActions } from "../store/accentSlice";
import { ACCENT_PRESET_ORDER, ACCENT_PRESETS } from "../theme/accentPresets";
import { uiActions } from "../store/uiSlice";
import "./SettingsPage.scss";

const THEME_OPTIONS: { value: DashboardTheme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const SettingsPage = () => {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.theme.theme);
  const accent = useAppSelector((state) => state.accent.accent);

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

      <section className="settingsCard" aria-labelledby="appearance-heading">
        <div className="settingsCardHeading">
          <div className="settingsCardIcon"><FontAwesomeIcon icon={faSun} /></div>
          <div>
            <h2 id="appearance-heading">Appearance</h2>
            <p>Choose how UGS Dashboard looks on this device.</p>
          </div>
        </div>

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
      </section>

      <section className="settingsCard settingsCardFuture" aria-labelledby="more-settings-heading">
        <h2 id="more-settings-heading">More settings</h2>
        <p>Additional dashboard preferences will appear here as they are added.</p>
      </section>
    </main>
  );
};

export default SettingsPage;
