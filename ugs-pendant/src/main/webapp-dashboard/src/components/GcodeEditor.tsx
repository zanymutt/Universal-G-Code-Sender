import { useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { Button, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronUp,
  faCrosshairs,
  faLock,
  faFloppyDisk,
  faFileExport,
  faForward,
  faListCheck,
  faMagnifyingGlass,
  faMinus,
  faPlus,
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../hooks/useAppSelector";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { useEditorFontSize } from "../hooks/useEditorFontSize";
import { getFileContent, saveFileContent, saveFileContentAs } from "../services/fileContent";
import { registerEditorSaveHandler } from "../services/editorSaveBridge";
import { runFromLine } from "../services/files";
import { refreshFileState } from "../store/refreshFileState";
import { uiActions } from "../store/uiSlice";
import { gcodeLanguage, gcodeSyntaxHighlighting } from "./gcodeLanguage";
import SaveAsModal from "./SaveAsModal";
import ConfirmDialog from "./ConfirmDialog";
import { getFileName } from "../utils/getFileName";
import { GcodeReviewResult, reviewGcode } from "../services/gcodeReview";
import { findingKey, loadIgnoredFindings, saveIgnoredFindings, splitIgnored } from "../utils/gcodeReviewIgnore";
import { clampReviewHeight, loadReviewHeight, saveReviewHeight } from "../utils/gcodeReviewHeight";
import { layoutScale } from "../utils/layoutRect";
import { countMatches, formatMatchCount } from "../utils/searchMatchCount";
import "./GcodeEditor.scss";

// Font-size is deliberately not set here - it's owned entirely by the
// fontSizeCompartment below (see useEditorFontSize's own comment on why).
const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--dashboard-surface)" },
    // caretColor: CodeMirror's base theme sets the (native) caret to black on
    // any theme not flagged dark, invisible on this dark surface - follow the
    // text color instead so it flips with the dashboard theme.
    ".cm-content": { fontFamily: "monospace", color: "var(--dashboard-text)", caretColor: "var(--dashboard-text)" },
    ".cm-gutters": { backgroundColor: "var(--dashboard-surface)", color: "var(--dashboard-text-disabled)", border: "none" },
    ".cm-activeLine": { backgroundColor: "var(--dashboard-bg)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--dashboard-bg)" },
    "&.cm-focused": { outline: "none" },
    // Same slim scrollbar as the rest of the dashboard (see _scrollbar.scss) -
    // CodeMirror's own scroll container, so it needs its own copy here rather
    // than picking that up from a wrapping element.
    ".cm-scroller": {
      scrollbarWidth: "thin",
      scrollbarColor: "var(--dashboard-border-strong) transparent",
      "&::-webkit-scrollbar": { width: "8px" },
      "&::-webkit-scrollbar-thumb": { backgroundColor: "var(--dashboard-border-strong)", borderRadius: "4px" },
      "&::-webkit-scrollbar-track": { background: "transparent" },
    },
  }
);

// Dims lines 1..N (1-based, inclusive) to show what won't actually run next -
// either because they've already been sent (live during a job) or because
// they're being skipped by an armed "run from" line. A StateField (rather
// than the Compartment used for the editable toggle below) is the more
// natural CM6 fit here: it reacts to a dispatched effect on its own, no
// explicit reconfigure() call needed, and every plain edit transaction just
// remaps its existing ranges via tr.changes like any other decoration.
const setDimThroughLine = StateEffect.define<number>();
const dimmedLineMark = Decoration.line({ class: "cm-dimmedLine" });

const dimThroughField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDimThroughLine)) continue;
      if (effect.value <= 0) return Decoration.none;

      const lastLine = Math.min(effect.value, tr.state.doc.lines);
      const ranges = [];
      for (let line = 1; line <= lastLine; line++) {
        ranges.push(dimmedLineMark.range(tr.state.doc.line(line).from));
      }
      return Decoration.set(ranges);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Highlights the single line currently running (0 = none) - matches
// lastCompletedLineNumber, the same "just-completed command" convention the
// visualizer's own live yellow highlight already uses (see Visualizer3D.tsx),
// not the next line about to run. That line also falls inside dimThroughLine's
// own inclusive range above (during a run they're driven by the same value -
// see currentRunLine below), so it would otherwise get dimmed like every
// other already-run line; .cm-currentRunLine.cm-dimmedLine below overrides
// that specifically, so the current line reads as active/highlighted, not
// grayed out along with the rest of what's already run.
const setCurrentRunLine = StateEffect.define<number>();
const currentRunLineMark = Decoration.line({ class: "cm-currentRunLine" });

const currentRunLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setCurrentRunLine)) continue;
      if (effect.value <= 0 || effect.value > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([currentRunLineMark.range(tr.state.doc.line(effect.value).from)]);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Font size AND line height, together. The line height is a whole number of
// pixels on purpose: with the default 1.4 multiple it is fractional (19.6px at
// 14px), the browser lays lines out at 19.59375px, and CodeMirror's estimate
// for the lines it hasn't drawn yet is 19.6px. Every time it then measures
// real lines it corrects the document height by a hair and compensates by
// writing scrollTop - and a script scroll in the middle of a native
// scrollbar-thumb drag makes Chrome re-baseline the drag and swallow the next
// pointer move. On a long file that was every other move, so the thumb fell
// further and further behind the mouse. With an integer height the estimate
// is exact, CodeMirror never has to correct anything, and the thumb tracks the
// pointer 1:1.
const editorSizeTheme = (fontSize: number) =>
  EditorView.theme({
    "&": { fontSize: `${fontSize}px` },
    ".cm-scroller": { lineHeight: `${Math.round(fontSize * 1.4)}px` },
  });

// "12/345" in the find panel. CodeMirror's panel has no match counter, so this
// adds one next to the find field. It re-counts (a little after the change, so
// typing stays snappy) when the query, the selection or the document changes,
// or the panel opens - and renders straight into the panel's DOM, since the
// panel itself isn't ours to template.
function* matchRanges(cursor: Iterator<{ from: number; to: number }>) {
  for (let result = cursor.next(); !result.done; result = cursor.next()) yield result.value;
}

const searchCountPlugin = ViewPlugin.fromClass(
  class {
    private timer: number | undefined;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      const panelToggled = searchPanelOpen(update.state) !== searchPanelOpen(update.startState);
      const queryChanged = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)));
      if (panelToggled || queryChanged || update.docChanged || update.selectionSet) this.schedule();
    }

    private schedule() {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.render(), 40);
    }

    private render() {
      const panel = this.view.dom.querySelector<HTMLElement>(".cm-search");
      if (!panel) return;
      let element = panel.querySelector<HTMLElement>(".cm-searchCount");
      if (!element) {
        element = document.createElement("span");
        element.className = "cm-searchCount";
        element.setAttribute("aria-live", "polite");
        panel.querySelector('[name="search"]')?.after(element);
      }
      const state = this.view.state;
      const query = getSearchQuery(state);
      const count =
        query.search && query.valid
          ? countMatches(matchRanges(query.getCursor(state)), state.selection.main)
          : null;
      const label = formatMatchCount(count, query.valid);
      element.textContent = label.text;
      element.dataset.state = label.state;
      element.title = label.state === "found" ? "Current match / total matches" : "";
    }

    destroy() {
      window.clearTimeout(this.timer);
    }
  }
);

// Lines the G-code review flagged, marked in the editor itself so the problem
// is seen in context rather than only listed in the review panel. Like
// dimThroughField this maps through edits on its own, so a mark stays on its
// line as text above it is inserted or deleted.
type ReviewMark = { line: number; severity: "ERROR" | "WARNING"; selected: boolean };
const setReviewMarks = StateEffect.define<ReviewMark[]>();

const reviewMarksField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setReviewMarks)) continue;
      const doc = tr.state.doc;
      // One decoration per line: an error outranks a warning, and the line
      // holding the selected finding is "selected" even if another shares it.
      const byLine = new Map<number, ReviewMark>();
      for (const mark of effect.value) {
        if (mark.line < 1 || mark.line > doc.lines) continue;
        const existing = byLine.get(mark.line);
        byLine.set(mark.line, {
          line: mark.line,
          severity: existing?.severity === "ERROR" || mark.severity === "ERROR" ? "ERROR" : "WARNING",
          selected: Boolean(existing?.selected) || mark.selected,
        });
      }
      return Decoration.set(
        Array.from(byLine.values()).map((mark) =>
          Decoration.line({
            class: `cm-reviewMark ${mark.severity === "ERROR" ? "cm-reviewError" : "cm-reviewWarning"}${mark.selected ? " cm-reviewSelected" : ""}`,
          }).range(doc.line(mark.line).from)
        ),
        true
      );
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Second attempt at this (see git history for the first) - y: "center" was
// the actual mistake, not just a rough edge needing a clamp. Centering a
// line requires CodeMirror to know how much content sits both *above and
// below* it, including whatever's still virtualized/unmeasured - for a
// large jump into never-rendered territory (a fast job's final lines,
// arriving faster than measurement can settle) that estimate is exactly
// the thing confirmed unreliable, in both directions: short (scrollTop 0
// after jumping from line ~1 to 141 of 144) and long (scrolled past the
// real end, leaving blank space below the last line - the black bar this
// was originally reported against). A clamp against the scroller's own
// scrollHeight only helps when scrollHeight itself is already correct,
// which is precisely what's in question near either edge.
//
// y: "nearest" doesn't have this problem: it only needs to know whether the
// target is above or below the *current* viewport and by how much, not the
// full document's shape on both sides - and it's a genuine no-op whenever
// the target is already visible, which is most calls during a real run
// (consecutive lines are usually still on-screen from the last one).
// Fewer, smaller scrolls means less exposure to virtualization measurement
// lagging behind in the first place, not just a better-clamped correction
// after the fact.
function scrollLineIntoView(view: EditorView, line: number, stillCurrent: () => boolean, retries = 3) {
  const pos = view.state.doc.line(line).from;
  const attempt = (remaining: number) => {
    // Re-checked on every retry, not just once up front - during an actual
    // run this is called again on essentially every completed command, so a
    // still-in-flight older sequence (from a line a few commands back) can
    // otherwise fire one of its own later retries *after* a newer call
    // already scrolled to the real current line, undoing it back toward the
    // stale target. stillCurrent (see call sites) checks against the latest
    // requested line, not just whether the view itself is still alive.
    if (!stillCurrent()) return;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 80 }) });
    // Belt and suspenders, cheap to keep: still clamps an overshoot past the
    // real end on the rare big jump (e.g. this component's own initial
    // mount mid-run) where scrollHeight briefly overestimates.
    const maxScrollTop = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
    if (view.scrollDOM.scrollTop > maxScrollTop) {
      view.scrollDOM.scrollTop = maxScrollTop;
    }
    if (remaining > 1) requestAnimationFrame(() => attempt(remaining - 1));
  };
  attempt(retries);
}

const GcodeEditor = () => {
  const dispatch = useAppDispatch();
  const fileStatus = useAppSelector((state) => state.fileStatus);
  const currentState = useAppSelector((state) => state.status.state);
  const fileName = useMemo(() => getFileName(fileStatus.fileName), [fileStatus.fileName]);
  // Editing the file on disk doesn't touch the controller, so it doesn't need
  // a connection (or even IDLE) - only actually streaming a job makes editing
  // unsafe, since the file being sent could then no longer match what's open
  // here.
  const isEditable = currentState !== "RUN" && currentState !== "HOLD" && currentState !== "CHECK";
  // "Run from here" only arms a line on the backend (see runFromLine) - it
  // doesn't send anything itself, so - like opening/editing - it doesn't
  // need a connection either. Only Start (separately, in the job bar) needs
  // one. Same gate as isEditable: blocked only while a job is actually
  // streaming.
  const canRunFrom = isEditable;
  const armedRunFromLine = useAppSelector((state) => state.ui.runFromLine);
  // What to dim: while a job is actually streaming, everything already sent;
  // otherwise, whatever's armed to be skipped by "run from" - the two never
  // apply at once, since arming is itself blocked while a job is running
  // (see canRunFrom above).
  //
  // lastCompletedLineNumber, not completedRowCount: the latter just counts
  // rows from zero for whatever's currently streaming, which undercounts
  // badly once "run from" starts a stream partway through the file (it'd
  // read 1, 2, 3... instead of the actual line numbers) - lastCompletedLineNumber
  // is the original file's own line number instead, correct either way. It's
  // already inclusive (see dimThroughField's own comment), so dims exactly
  // through the line that just completed, no further adjustment needed.
  //
  // armedRunFromLine - 1, not - 2: this is purely an editor-line fact ("dim
  // everything before the line that was selected"), not a conversion to the
  // backend's command-index argument - confirmed armedRunFromLine itself
  // does become the actual resume point (see handleConfirmRunFrom), so
  // there's no offset to apply here at all. Don't "helpfully" re-apply the
  // -2 fix from there - that was already tried here and was wrong, it left
  // the line right before the resume point undimmed.
  const dimThroughLine =
    currentState === "RUN" || currentState === "HOLD" || currentState === "CHECK"
      ? fileStatus.lastCompletedLineNumber
      : armedRunFromLine > 0
        ? armedRunFromLine - 1
        : 0;
  // Not just dimThroughLine reused directly - the two agree during an actual
  // run (both driven by lastCompletedLineNumber then), but dimThroughLine
  // also covers the "armed run-from, not yet started" case, which has no
  // currently-running line at all (0 = none, matching setCurrentRunLine's
  // own "nothing highlighted" convention).
  // The visualizer's simulation drives the same highlight (and scroll-follow)
  // when no real job is running - the two can't overlap, since the simulation
  // exits itself the moment a job starts.
  const simLine = useAppSelector((state) => state.ui.simLine);
  const currentRunLine =
    currentState === "RUN" || currentState === "HOLD" || currentState === "CHECK"
      ? fileStatus.lastCompletedLineNumber
      : simLine;

  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The editable state needs to change without tearing down and recreating the
  // whole editor (that would also blow away undo history/cursor position) - a
  // Compartment lets it be reconfigured in place from the effect below.
  const editableCompartmentRef = useRef(new Compartment());
  // Same Compartment pattern, for the font-size control below - independent
  // of the whole-page Zoom (see useEditorFontSize's own comment).
  const fontSizeCompartmentRef = useRef(new Compartment());
  const { fontSize, increase: increaseFontSize, decrease: decreaseFontSize, setExact: setFontSize, canIncrease, canDecrease } =
    useEditorFontSize();
  // dimThroughField/currentRunLineField both start empty (Decoration.none)
  // and rely on a dispatched effect to populate them - normally the one
  // below, keyed on [dimThroughLine]/[currentRunLine]. But the editor's own
  // creation (right below) is itself async (getFileContent().then(...)), so
  // if a job is already RUN/HOLD/CHECK the moment this file first opens
  // (e.g. the page was reloaded mid-job), that effect can fire, find
  // viewRef.current still null, and no-op - with nothing left to retry it
  // since the value it would have dispatched never changes again once the
  // job's already at that line. Latest-value refs (rather than the
  // getFileContent().then() closure's own, possibly-stale-by-then capture)
  // let the editor apply the correct initial decorations itself, right after
  // it's actually created.
  const dimThroughLineRef = useRef(dimThroughLine);
  dimThroughLineRef.current = dimThroughLine;
  const currentRunLineRef = useRef(currentRunLine);
  currentRunLineRef.current = currentRunLine;
  // The one below, watching for the editor to actually become visible so
  // the initial scroll-to-current-line can be applied correctly - torn down
  // in the same cleanup that destroys the view, in case it's still waiting
  // (never became visible) when the file changes again.
  const scrollObserverRef = useRef<ResizeObserver | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  // 1-based, matching what the gutter shows - defaults to the first line so
  // the button always has a sensible target even before anyone taps a line.
  const [cursorLine, setCursorLine] = useState(1);
  const [showRunFromConfirm, setShowRunFromConfirm] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [review, setReview] = useState<GcodeReviewResult | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // Finding keys the person chose to ignore (persisted - see gcodeReviewIgnore).
  const [ignoredKeys, setIgnoredKeys] = useState<string[]>(() => loadIgnoredFindings());
  const [showIgnored, setShowIgnored] = useState(false);
  // Index into the *active* (non-ignored) findings, or null for none.
  const [selectedFinding, setSelectedFinding] = useState<number | null>(null);
  // The text was edited after the review ran, so its line numbers/findings
  // may no longer match what's on screen.
  const [reviewStale, setReviewStale] = useState(false);
  const reviewListRef = useRef<HTMLDivElement | null>(null);
  // Whether the editor is following the running line (a live job, or the
  // visualizer's simulation). Following re-scrolls on every completed command -
  // fine until someone drags the scrollbar away, when it would yank the view
  // back each time. So it pauses the moment the person scrolls by hand, and
  // the "Follow run" button (or the next run) resumes it. A ref mirrors the
  // state because the scroll listeners and retry loops registered once need
  // the current value, not the one from when they were created.
  const [followRunLine, setFollowRunLine] = useState(true);
  const followRef = useRef(true);
  followRef.current = followRunLine;
  // The panel's height once the person has dragged its top edge (null = the
  // automatic height from CSS). Dragging works in layout pixels - the same
  // units the height is applied in - so it stays correct at any dashboard zoom.
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const reviewPanelRef = useRef<HTMLDivElement | null>(null);
  const [reviewHeight, setReviewHeight] = useState<number | null>(() => loadReviewHeight());
  const reviewResizeRef = useRef<{ startY: number; startHeight: number; scale: number } | null>(null);
  const ignoredSet = useMemo(() => new Set(ignoredKeys), [ignoredKeys]);
  const { active: activeFindings, hidden: ignoredFindings } = useMemo(
    () => splitIgnored(review?.diagnostics ?? [], ignoredSet),
    [review, ignoredSet]
  );

  // Mirrors isDirty into uiSlice too (see its own comment) - every place that
  // would otherwise call setIsDirty directly goes through this instead, so
  // the two can never drift apart.
  const setDirty = (dirty: boolean) => {
    setIsDirty(dirty);
    dispatch(uiActions.setEditorIsDirty(dirty));
  };

  useEffect(() => {
    if (!editorContainerRef.current || !fileName) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setDirty(false);
    setCursorLine(1);
    dispatch(uiActions.setEditorCursorLine(1));
    // A review belongs to the text it was run on.
    setShowReview(false);
    setReview(null);
    setSelectedFinding(null);
    // Mirrors the backend's own auto-reset-on-open (RunFromService resets to
    // a normal full run whenever a new file is opened) so the job bar's
    // armed-line badge doesn't keep pointing at a line from a previous file.
    dispatch(uiActions.setRunFromLine(0));

    let cancelled = false;
    getFileContent()
      .then((content) => {
        if (cancelled || !editorContainerRef.current) return;

        viewRef.current?.destroy();
        viewRef.current = new EditorView({
          state: EditorState.create({
            doc: content,
            extensions: [
              lineNumbers(),
              highlightActiveLine(),
              history(),
              keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
              // Find / replace (Ctrl+F, or the toolbar's Find button). On top so
              // it doesn't fight the review panel and run controls below.
              search({ top: true }),
              searchCountPlugin,
              EditorState.phrases.of({
                next: "Next",
                previous: "Previous",
                all: "All",
                "match case": "Match case",
                regexp: "Regex",
                "by word": "Whole word",
                replace: "Replace",
                "replace all": "Replace all",
                close: "Close",
              }),
              gcodeLanguage,
              gcodeSyntaxHighlighting,
              editorTheme,
              editableCompartmentRef.current.of([EditorView.editable.of(isEditable), EditorState.readOnly.of(!isEditable)]),
              fontSizeCompartmentRef.current.of(editorSizeTheme(fontSize)),
              dimThroughField,
              currentRunLineField,
              reviewMarksField,
              EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                  setDirty(true);
                  setReviewStale(true);
                }
                if (update.selectionSet || update.docChanged) {
                  const line = update.state.doc.lineAt(update.state.selection.main.head).number;
                  setCursorLine(line);
                  dispatch(uiActions.setEditorCursorLine(line));
                }
              }),
            ],
          }),
          parent: editorContainerRef.current,
        });

        // Hand scrolling pauses following (see followRunLine). Only real user
        // input counts - a scroll event on its own can't tell us who moved
        // it, and CodeMirror also corrects scrollTop itself as it measures
        // lines, which must not be mistaken for the person scrolling.
        const scroller = viewRef.current.scrollDOM;
        const pauseFollow = () => {
          if (!followRef.current) return;
          followRef.current = false;
          setFollowRunLine(false);
        };
        scroller.addEventListener("wheel", pauseFollow, { passive: true });
        scroller.addEventListener("touchstart", pauseFollow, { passive: true });
        scroller.addEventListener("pointerdown", (event) => {
          // A press on the scroller element itself, past its content box, is
          // on its scrollbar (the thumb, track or arrows).
          if (event.target === scroller && (event.offsetX >= scroller.clientWidth || event.offsetY >= scroller.clientHeight)) {
            pauseFollow();
          }
        });
        scroller.addEventListener("keydown", (event) => {
          if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) pauseFollow();
        });

        // See dimThroughLineRef/currentRunLineRef's own comment above -
        // applies whatever's actually current right now, not whatever
        // dimThroughLine/currentRunLine happened to be when this effect was
        // first scheduled (this callback's own closure), in case a job was
        // already RUN/HOLD/CHECK before this file even finished loading.
        const initialLine = currentRunLineRef.current;
        viewRef.current.dispatch({
          effects: [setDimThroughLine.of(dimThroughLineRef.current), setCurrentRunLine.of(initialLine)],
        });
        // Scrolling needs to wait for the editor to actually have a size,
        // not just a layout tick - this file can finish loading (and this
        // whole callback run) while the Edit tab isn't the visible one yet,
        // in which case the container is display:none and reports a height
        // of 0 for as long as it stays hidden, however many frames pass (a
        // plain requestAnimationFrame delay confirmed this: still 0 a frame
        // later). A ResizeObserver fires the moment the container actually
        // gets a real size - immediately if it's already visible now, or
        // later, exactly when the user switches to the Edit tab.
        if (initialLine > 0 && initialLine <= viewRef.current.state.doc.lines) {
          const view = viewRef.current;
          const observer = new ResizeObserver((entries) => {
            if (cancelled || entries[0].contentRect.height === 0) return;
            observer.disconnect();
            scrollLineIntoView(
              view,
              initialLine,
              () => !cancelled && viewRef.current === view && currentRunLineRef.current === initialLine
            );
          });
          observer.observe(view.scrollDOM);
          scrollObserverRef.current = observer;
        }
      })
      .catch(() => !cancelled && setError("Couldn't load this file for editing."))
      .finally(() => !cancelled && setIsLoading(false));

    return () => {
      cancelled = true;
      scrollObserverRef.current?.disconnect();
      scrollObserverRef.current = null;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  // Keeps the editor's editable state in sync with the machine state on its
  // own, instead of only picking it up next time a file loads - previously,
  // opening a file while the machine hadn't yet reported IDLE (e.g. right
  // after connecting) froze the editor as non-editable/unclickable forever,
  // even once the machine settled into IDLE.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartmentRef.current.reconfigure([
        EditorView.editable.of(isEditable),
        EditorState.readOnly.of(!isEditable),
      ]),
    });
  }, [isEditable]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDimThroughLine.of(dimThroughLine) });
  }, [dimThroughLine]);

  // Highlights the running line and keeps it in view (scrolling only the
  // minimum needed, not forcing it back to center every time - see
  // scrollLineIntoView's own comment) as the job progresses - the same
  // "Follow" idea desktop's editor has by default, ported here since our
  // editor and the dashboard's visualizer are two separate views instead of
  // one.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({ effects: setCurrentRunLine.of(currentRunLine) });
    if (followRef.current && currentRunLine > 0 && currentRunLine <= view.state.doc.lines) {
      scrollLineIntoView(
        view,
        currentRunLine,
        () => viewRef.current === view && currentRunLineRef.current === currentRunLine && followRef.current
      );
    }
  }, [currentRunLine]);

  // Nothing running any more: the next run starts out followed again.
  useEffect(() => {
    if (currentRunLine === 0) {
      followRef.current = true;
      setFollowRunLine(true);
    }
  }, [currentRunLine]);

  const resumeFollow = () => {
    followRef.current = true;
    setFollowRunLine(true);
    const view = viewRef.current;
    if (view && currentRunLine > 0 && currentRunLine <= view.state.doc.lines) {
      scrollLineIntoView(view, currentRunLine, () => viewRef.current === view && followRef.current);
    }
  };

  const handleFind = () => {
    const view = viewRef.current;
    if (!view) return;
    openSearchPanel(view);
  };

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: fontSizeCompartmentRef.current.reconfigure(editorSizeTheme(fontSize)),
    });
  }, [fontSize]);

  // Keeps the editor's line marks in step with the review: shown only while
  // the panel is open, minus whatever's been ignored, with the selected
  // finding's line emphasised.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const marks: ReviewMark[] = showReview
      ? activeFindings.map((finding, index) => ({
          line: finding.lineNumber,
          severity: finding.severity,
          selected: index === selectedFinding,
        }))
      : [];
    view.dispatch({ effects: setReviewMarks.of(marks) });
  }, [showReview, activeFindings, selectedFinding]);

  // Keeps the selected finding visible in the panel's own list when stepping
  // through with the prev/next buttons.
  useEffect(() => {
    if (selectedFinding === null) return;
    reviewListRef.current
      ?.querySelector(`[data-finding-index="${selectedFinding}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedFinding]);

  const doSave = (): Promise<void> => {
    if (!viewRef.current || !fileName) return Promise.reject(new Error("No gcode file is open to save"));
    return saveFileContent(viewRef.current.state.doc.toString()).then(() => {
      setDirty(false);
      // Not just for other components (JobBar's Send status, Visualizer3D) -
      // this session's own websocket push for this same save isn't
      // guaranteed to have arrived yet either (see refreshFileState's own
      // comment), so without this the visualizer could still be showing the
      // pre-edit toolpath for a moment, or indefinitely on a slow/remote
      // connection.
      refreshFileState(dispatch);
    });
  };

  // Kept current every render (fileName/setDirty above would otherwise go
  // stale inside a mount-only effect) so the wrapper registered below can
  // stay registered exactly once for the component's whole lifetime while
  // still always calling whatever doSave currently is.
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // Lets the job bar (see editorSaveBridge's own comment) trigger the exact
  // same save this component's own Save button does, from anywhere in the
  // layout.
  useEffect(() => {
    registerEditorSaveHandler(() => doSaveRef.current());
    return () => registerEditorSaveHandler(null);
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    doSave()
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't save this file."))
      .finally(() => setIsSaving(false));
  };

  const handleSaveAsToWorkspace = (newFilename: string) => {
    if (!viewRef.current) return Promise.reject();
    return saveFileContentAs(newFilename, viewRef.current.state.doc.toString()).then(() => {
      setDirty(false);
      refreshFileState(dispatch);
    });
  };

  // CodeMirror's line numbers are 1-based. Desktop's own "Start program
  // here" (RunFromHere.java) computes root.getElementIndex(caretPosition) -
  // 1, where getElementIndex is *already* a 0-based line index on its own -
  // so its net result is two less than the 1-based line number, not one
  // less. Confirmed empirically against the real backend: sending only
  // "- 1" resumed one command later than desktop did for the identical
  // selected line (skipped one extra command) - matching "- 2" here fixed
  // it. line <= 1 lands at 0 or below, matching runFromLine's own <= 0 =
  // disabled convention, so no special-casing needed for the first line.
  const handleConfirmRunFrom = () => {
    runFromLine(cursorLine - 2).then(() => dispatch(uiActions.setRunFromLine(cursorLine)));
    setShowRunFromConfirm(false);
  };

  // Same reset the job bar's own "Reset" link does (see JobBar.tsx) - kept
  // here too so it's reachable right next to Run from line without having
  // to look down at the job bar, which may not even be in view depending on
  // layout.
  const resetRunFromLine = () => {
    runFromLine(0).then(() => dispatch(uiActions.setRunFromLine(0)));
  };

  const cursorLineText = viewRef.current?.state.doc.line(cursorLine).text ?? "";

  const handleReview = () => {
    const content = viewRef.current?.state.doc.toString();
    if (content === undefined) return;
    setShowReview(true);
    setReview(null);
    setReviewError(null);
    setSelectedFinding(null);
    setReviewStale(false);
    setIsReviewing(true);
    reviewGcode(content)
      .then(setReview)
      .catch((exception) => setReviewError(exception instanceof Error ? exception.message : "Couldn't review G-code."))
      .finally(() => setIsReviewing(false));
  };

  // Selecting a finding moves the cursor to its line and scrolls it into view
  // without taking keyboard focus: focusing the editor would pop the on-screen
  // keyboard on a tablet while someone is just stepping through problems.
  const selectFinding = (index: number) => {
    setSelectedFinding(index);
    const view = viewRef.current;
    const finding = activeFindings[index];
    if (!view || !finding) return;
    const lineNumber = Math.max(1, Math.min(finding.lineNumber, view.state.doc.lines));
    view.dispatch({ selection: { anchor: view.state.doc.line(lineNumber).from } });
    scrollLineIntoView(view, lineNumber, () => viewRef.current === view);
  };

  const stepFinding = (delta: 1 | -1) => {
    const count = activeFindings.length;
    if (count === 0) return;
    const next = selectedFinding === null ? (delta > 0 ? 0 : count - 1) : (selectedFinding + delta + count) % count;
    selectFinding(next);
  };

  const ignoreFinding = (finding: { severity: string; message: string }) => {
    const key = findingKey(finding);
    const next = [...ignoredKeys.filter((existing) => existing !== key), key];
    setIgnoredKeys(next);
    saveIgnoredFindings(next);
    setSelectedFinding(null);
  };

  const restoreFinding = (finding: { severity: string; message: string }) => {
    const key = findingKey(finding);
    const next = ignoredKeys.filter((existing) => existing !== key);
    setIgnoredKeys(next);
    saveIgnoredFindings(next);
  };

  const startReviewResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = reviewPanelRef.current;
    if (!panel) return;
    event.preventDefault();
    reviewResizeRef.current = { startY: event.clientY, startHeight: panel.offsetHeight, scale: layoutScale(panel) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveReviewResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = reviewResizeRef.current;
    const root = editorRootRef.current;
    if (!drag || !root) return;
    // Dragging up (smaller clientY) grows the panel, which is docked at the bottom.
    setReviewHeight(clampReviewHeight(drag.startHeight + (drag.startY - event.clientY) / drag.scale, root.clientHeight));
  };

  const endReviewResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!reviewResizeRef.current) return;
    reviewResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (reviewPanelRef.current) saveReviewHeight(reviewPanelRef.current.offsetHeight);
  };

  const nudgeReviewHeight = (delta: number) => {
    const panel = reviewPanelRef.current;
    const root = editorRootRef.current;
    if (!panel || !root) return;
    const next = clampReviewHeight((reviewHeight ?? panel.offsetHeight) + delta, root.clientHeight);
    setReviewHeight(next);
    saveReviewHeight(next);
  };

  const resetReviewHeight = () => {
    setReviewHeight(null);
    saveReviewHeight(null);
  };

  const errorCount = activeFindings.filter((item) => item.severity === "ERROR").length;
  const warningCount = activeFindings.length - errorCount;

  if (!fileName) {
    return <div className="gcodeEditorEmpty">No file loaded. Open a file from the Run tab first.</div>;
  }

  return (
    <div className="gcodeEditor" ref={editorRootRef}>
      {showSaveAs && (
        <SaveAsModal
          defaultFileName={fileName}
          getContent={() => viewRef.current?.state.doc.toString() ?? ""}
          onSaveToWorkspace={handleSaveAsToWorkspace}
          handleClose={() => setShowSaveAs(false)}
        />
      )}

      <ConfirmDialog
        show={showRunFromConfirm}
        title="Run from here?"
        message={
          `This only prepares line ${cursorLine} as the job's new starting point - it won't move the ` +
          `machine yet. The machine will restore position, spindle, coolant, and work offset before ` +
          `continuing from:\n\n${cursorLineText}\n\nPress Start afterward to actually begin.`
        }
        confirmLabel="Run from here"
        onConfirm={handleConfirmRunFrom}
        onCancel={() => setShowRunFromConfirm(false)}
      />

      <div className="gcodeEditorContent">
        {isLoading && <div className="gcodeEditorLoading">Loading...</div>}
        <div className="gcodeEditorCodeMirror" ref={editorContainerRef} />
        {/* Pills over the corner of the code: read-only while a job streams,
            and the way back to the running line after scrolling away. They
            stack (read-only above) so they never cover each other, and they
            use none of the toolbar's width. */}
        <div className="gcodeEditorOverlays">
          {!isEditable && (
            <span
              className="gcodeEditorReadOnly"
              role="status"
              aria-label="Read-only while a job is running"
              title="Read-only while a job is running"
            >
              <FontAwesomeIcon icon={faLock} /> Read-only
            </span>
          )}
          {!followRunLine && currentRunLine > 0 && (
            <button
              type="button"
              className="gcodeEditorFollow"
              onClick={resumeFollow}
              title="Scroll back to the running line and keep following it"
            >
              <FontAwesomeIcon icon={faCrosshairs} /> Follow run
            </button>
          )}
        </div>
      </div>

      {showReview && (
        <div
          className={"gcodeReviewPanel" + (reviewHeight !== null ? " custom" : "")}
          style={reviewHeight !== null ? { height: reviewHeight } : undefined}
          ref={reviewPanelRef}
          role="region"
          aria-label="G-code review"
        >
          {/* Drag up to show more findings at once; arrow keys nudge it and a
              double-click goes back to the automatic height. */}
          <div
            className="gcodeReviewResizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize review panel"
            title="Drag to resize (double-click to reset)"
            tabIndex={0}
            onPointerDown={startReviewResize}
            onPointerMove={moveReviewResize}
            onPointerUp={endReviewResize}
            onPointerCancel={endReviewResize}
            onDoubleClick={resetReviewHeight}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                nudgeReviewHeight(event.shiftKey ? 96 : 24);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                nudgeReviewHeight(event.shiftKey ? -96 : -24);
              }
            }}
          />
          <div className="gcodeReviewPanelHeader">
            <span className="gcodeReviewPanelTitle">Review</span>
            <span className="gcodeReviewSummary">
              {isReviewing && <><Spinner size="sm" /> Reviewing…</>}
              {!isReviewing && reviewError && <span className="gcodeReviewErrorText">{reviewError}</span>}
              {!isReviewing && !reviewError && review && (
                activeFindings.length === 0
                  ? ignoredFindings.length === 0
                    ? <span className="gcodeReviewOk">No parser errors or unknown G/M-codes in {review.lineCount} lines.</span>
                    : <span className="gcodeReviewOk">Nothing left to review - {ignoredFindings.length} ignored.</span>
                  : <>
                      {errorCount > 0 && <span className="gcodeReviewCount error">{errorCount} error{errorCount === 1 ? "" : "s"}</span>}
                      {warningCount > 0 && <span className="gcodeReviewCount warning">{warningCount} warning{warningCount === 1 ? "" : "s"}</span>}
                    </>
              )}
            </span>
            <div className="gcodeReviewPanelActions">
              {ignoredFindings.length > 0 && (
                <label className="gcodeReviewShowIgnored">
                  <input type="checkbox" checked={showIgnored} onChange={(event) => setShowIgnored(event.target.checked)} />
                  Ignored ({ignoredFindings.length})
                </label>
              )}
              <button type="button" onClick={() => stepFinding(-1)} disabled={activeFindings.length === 0}
                aria-label="Previous finding" title="Previous finding">
                <FontAwesomeIcon icon={faChevronUp} />
              </button>
              <button type="button" onClick={() => stepFinding(1)} disabled={activeFindings.length === 0}
                aria-label="Next finding" title="Next finding">
                <FontAwesomeIcon icon={faChevronDown} />
              </button>
              <button type="button" onClick={handleReview} disabled={isReviewing}
                aria-label="Review again" title="Review the current editor text again">
                <FontAwesomeIcon icon={faRotateRight} />
              </button>
              <button type="button" onClick={() => setShowReview(false)} aria-label="Close review" title="Close review">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          </div>
          {reviewStale && review && !isReviewing && (
            <div className="gcodeReviewStale">
              The text has changed since this review.{" "}
              <button type="button" onClick={handleReview}>Review again</button>
            </div>
          )}
          <div className="gcodeReviewList" ref={reviewListRef}>
            {activeFindings.map((finding, index) => (
              <div
                role="button"
                tabIndex={0}
                data-finding-index={index}
                className={`gcodeReviewFinding ${finding.severity === "ERROR" ? "error" : "warning"}${index === selectedFinding ? " selected" : ""}`}
                key={`${finding.lineNumber}-${index}`}
                onClick={() => selectFinding(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectFinding(index);
                  }
                }}
              >
                <span className="gcodeReviewFindingLine">Line {finding.lineNumber}</span>
                <span className="gcodeReviewFindingMessage">{finding.message}</span>
                <button
                  type="button"
                  className="gcodeReviewIgnore"
                  onClick={(event) => {
                    event.stopPropagation();
                    ignoreFinding(finding);
                  }}
                  title="Hide this finding from future reviews"
                >
                  Ignore
                </button>
                <code>{finding.source}</code>
              </div>
            ))}
            {showIgnored && ignoredFindings.map((finding, index) => (
              <div className="gcodeReviewFinding ignored" key={`ignored-${finding.lineNumber}-${index}`}>
                <span className="gcodeReviewFindingLine">Line {finding.lineNumber}</span>
                <span className="gcodeReviewFindingMessage">{finding.message}</span>
                <button type="button" className="gcodeReviewIgnore" onClick={() => restoreFinding(finding)}
                  title="Show this finding in reviews again">
                  Restore
                </button>
                <code>{finding.source}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="gcodeEditorToolbar">
        <span className="gcodeEditorFileName">{fileName}</span>
        {error && <span className="gcodeEditorError">{error}</span>}
        <Button
          className="gcodeEditorFind"
          variant="outline-secondary"
          onClick={handleFind}
          title="Find and replace (Ctrl+F)"
        >
          <FontAwesomeIcon icon={faMagnifyingGlass} /> <span className="gcodeEditorButtonLabel">Find</span>
        </Button>
        <Button
          className="gcodeEditorReview"
          variant="outline-secondary"
          onClick={handleReview}
          title="Review the current editor contents for parser findings"
        >
          <FontAwesomeIcon icon={faListCheck} /> <span className="gcodeEditorButtonLabel">Review</span>
        </Button>
        <Button
          className="gcodeEditorRunFrom"
          variant="outline-secondary"
          disabled={!canRunFrom}
          title={canRunFrom ? undefined : "Can't arm a starting line while a job is running"}
          onClick={() => setShowRunFromConfirm(true)}
        >
          {/* Compact mode (see the @container rule in GcodeEditor.scss) drops
              everything but the icon and the line number itself - "Run from
              line" is the part worth losing first when space is tight. */}
          <FontAwesomeIcon icon={faForward} /> <span className="gcodeEditorButtonLabel">Run from line </span>
          {cursorLine}
        </Button>
        {armedRunFromLine > 0 && (
          <button type="button" className="gcodeEditorRunFromReset" onClick={resetRunFromLine}>
            Reset
          </button>
        )}
        <Button
          className="gcodeEditorSave"
          variant="outline-secondary"
          disabled={!isEditable || isSaving}
          onClick={() => setShowSaveAs(true)}
        >
          <FontAwesomeIcon icon={faFileExport} /> <span className="gcodeEditorButtonLabel">Save as</span>
        </Button>
        <Button
          className="gcodeEditorSave"
          variant="primary"
          disabled={!isEditable || !isDirty || isSaving}
          onClick={handleSave}
        >
          <FontAwesomeIcon icon={faFloppyDisk} /> <span className="gcodeEditorButtonLabel">Save</span>{" "}
          {isSaving && <Spinner size="sm" />}
        </Button>

        <div className="gcodeEditorFontSize" title="Gcode text size - independent of the page Zoom, always rendered at its actual size">
          <div className="gcodeEditorFontSizeButtons">
            <Button variant="secondary" size="sm" disabled={!canDecrease} onClick={decreaseFontSize} title="Smaller text">
              <FontAwesomeIcon icon={faMinus} />
            </Button>
            <span className="gcodeEditorFontSizeValue">{fontSize}px</span>
            <Button variant="secondary" size="sm" disabled={!canIncrease} onClick={increaseFontSize} title="Larger text">
              <FontAwesomeIcon icon={faPlus} />
            </Button>
          </div>
          <input className="gcodeEditorFontSizeSlider" type="range" min="12" max="28" step="2" value={fontSize}
            aria-label="Gcode text size" onChange={event => setFontSize(Number(event.target.value))} />
        </div>
      </div>
    </div>
  );
};

export default GcodeEditor;
