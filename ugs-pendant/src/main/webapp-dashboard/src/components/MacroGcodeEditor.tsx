import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useEditorFontSize } from "../hooks/useEditorFontSize";
import { gcodeLanguage, gcodeSyntaxHighlighting } from "./gcodeLanguage";
import "./MacroGcodeEditor.scss";

// Font-size is deliberately not set here - see fontSizeCompartment below and
// useEditorFontSize's own comment on why. Shares that one setting/storage
// key with the main gcode editor rather than getting its own - there's no
// reason to want the macro editor's gcode at a different size, and Split
// mode can show both editors at once, where two independent settings could
// visibly disagree on-screen at the same time.
const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "#1c1e1f" },
    ".cm-content": { fontFamily: "monospace" },
    ".cm-gutters": { backgroundColor: "#1c1e1f", color: "#5b6062", border: "none" },
    ".cm-activeLine": { backgroundColor: "#232526" },
    ".cm-activeLineGutter": { backgroundColor: "#232526" },
    "&.cm-focused": { outline: "none" },
    // Same dark, slim scrollbar as the rest of the dashboard (see
    // _scrollbar.scss) - CodeMirror's own scroll container, so it needs its
    // own copy here rather than picking that up from a wrapping element.
    ".cm-scroller": {
      scrollbarWidth: "thin",
      scrollbarColor: "#3a3d3e transparent",
      "&::-webkit-scrollbar": { width: "8px" },
      "&::-webkit-scrollbar-thumb": { backgroundColor: "#3a3d3e", borderRadius: "4px" },
      "&::-webkit-scrollbar-track": { background: "transparent" },
    },
  },
  { dark: true }
);

export type MacroGcodeEditorHandle = {
  insertAtCursor: (text: string) => void;
};

type Props = {
  initialValue: string;
  onChange: (text: string) => void;
};

// A small CodeMirror wrapper so the macro editor's gcode field gets the same
// syntax highlighting as the main gcode editor (see gcodeLanguage.ts), rather
// than a plain textarea. Uncontrolled by design - `initialValue` only seeds
// the doc on mount; MacroEditor forces a remount (via a key) whenever the
// selected macro changes or edits are discarded, same trick MacroForm's old
// textarea state relied on, so there's no need to sync a `value` prop back in.
const MacroGcodeEditor = forwardRef<MacroGcodeEditorHandle, Props>(({ initialValue, onChange }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fontSizeCompartmentRef = useRef(new Compartment());
  const { fontSize } = useEditorFontSize();

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          gcodeLanguage,
          gcodeSyntaxHighlighting,
          editorTheme,
          fontSizeCompartmentRef.current.of(EditorView.theme({ "&": { fontSize: `${fontSize}px` } })),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-updates if the shared font-size setting changes while this editor
  // is already mounted - most visibly reachable via Split mode, which can
  // show the Macros pane (this editor) and the Edit tab (with the actual
  // +/- control) on screen at the same time.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: fontSizeCompartmentRef.current.reconfigure(EditorView.theme({ "&": { fontSize: `${fontSize}px` } })),
    });
  }, [fontSize]);

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
  }));

  return <div className="macroGcodeEditor" ref={containerRef} />;
});

export default MacroGcodeEditor;
