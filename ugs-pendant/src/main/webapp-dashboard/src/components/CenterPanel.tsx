import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Nav } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faColumns } from "@fortawesome/free-solid-svg-icons";
import Visualizer3D from "./Visualizer3D";
import GcodeEditor from "./GcodeEditor";
import ConsolePanel from "./ConsolePanel";
import MacroEditor from "./MacroEditor";
import ProbePanel from "./ProbePanel";
import { useAppSelector } from "../hooks/useAppSelector";
import { useAppDispatch } from "../hooks/useAppDispatch";
import { uiActions, CenterView, PaneContent, BottomView } from "../store/uiSlice";
import "./CenterPanel.scss";

const CONSOLE_MIN_HEIGHT = 100;
const CONSOLE_MAX_HEIGHT = 640;
// Macros' own list panel alone is 160px wide in compact mode, so anything
// much smaller than this leaves almost nothing for the actual form/settings
// - this is the floor for BOTH panes (it also caps how far the other side
// can grow via onSplitResizeMove's maxWidth calculation).
const SPLIT_MIN_WIDTH = 400;

const PANE_LABELS: { content: PaneContent; label: string }[] = [
  { content: "visualize", label: "Visualize" },
  { content: "edit", label: "Edit" },
  { content: "macros", label: "Macros" },
  { content: "probe", label: "Probe" },
];

const CenterPanel = () => {
  const dispatch = useAppDispatch();
  // Lifted to Redux (rather than local state) so the RightRail's macro edit
  // button can jump here to the Macros tab without CenterPanel and RightRail
  // needing to know about each other, and so the split pane assignments
  // survive toggling in and out of split mode.
  const view = useAppSelector((state) => state.ui.centerView);
  const splitLeft = useAppSelector((state) => state.ui.splitLeft);
  const splitRight = useAppSelector((state) => state.ui.splitRight);
  const isSplit = view === "split";
  const setView = (next: CenterView) => dispatch(uiActions.setCenterView(next));

  const bottomView = useAppSelector((state) => state.ui.bottomView);
  const isBottomSplit = bottomView === "split";
  // The top pane system can't offer "Edit" while the bottom panel owns it
  // (as "edit" alone or as half of "split") - see setBottomView. Filtering
  // it out of the label list (rather than just disabling that one Nav.Link)
  // also means neither nav can end up showing it as still "active" for a
  // frame before the reducer's own reassignment re-renders.
  const topPaneLabels = bottomView !== "console" ? PANE_LABELS.filter((p) => p.content !== "edit") : PANE_LABELS;

  // GcodeEditor is a single component instance that lives in exactly one of
  // two possible slots (the top pane system's "edit" spot, or here in the
  // console split) at any given time - never both, and never remounted when
  // it moves between them, so its cursor/undo/unsaved-buffer state survives
  // the switch. Both slot elements are always mounted (just hidden via CSS
  // when not in use) so their refs are stable; a portal renders the actual
  // <GcodeEditor/> into whichever one is currently active. Using setState
  // directly as the ref callback (rather than a plain useRef) forces the
  // re-render createPortal needs at exactly the moment each slot's DOM node
  // becomes available, instead of silently portaling into `null` for a
  // frame after mount.
  const [topEditSlot, setTopEditSlot] = useState<HTMLDivElement | null>(null);
  const [bottomEditSlot, setBottomEditSlot] = useState<HTMLDivElement | null>(null);
  const activeEditSlot = bottomView !== "console" ? bottomEditSlot : topEditSlot;

  // The portal below always targets THIS one div, created once and never
  // swapped - React keys a portal's identity on its container, so changing
  // *which* element createPortal targets doesn't actually move the portal:
  // React treats a container change as not an update, unmounting and
  // recreating the portaled subtree from scratch. Confirmed the hard way -
  // passing activeEditSlot directly as the container silently discarded
  // GcodeEditor's unsaved edits, cursor position, and undo history every
  // time it swapped between topEditSlot and bottomEditSlot. Keeping the
  // portal's container fixed avoids that; this div is instead physically
  // relocated between the two visible slots via plain DOM appendChild in
  // the layout effect below - a real node move, which (unlike changing a
  // portal's container) preserves everything inside it, the same as
  // dragging any other DOM node from one parent to another.
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  if (editorHostRef.current === null) {
    const host = document.createElement("div");
    // Transparent to layout - GcodeEditor's own root expects height: 100%
    // of its immediate parent; display: contents removes this wrapper from
    // the box tree entirely so that resolves against the actual slot div
    // instead of needing to replicate its sizing here.
    host.style.display = "contents";
    editorHostRef.current = host;
  }

  useLayoutEffect(() => {
    if (activeEditSlot) {
      activeEditSlot.appendChild(editorHostRef.current!);
    }
  }, [activeEditSlot]);

  const [consoleHeight, setConsoleHeight] = useState(220);
  const dragStartRef = useRef({ y: 0, height: 0 });

  // null = true 50/50, same convention as splitLeftWidth below. Only
  // meaningful while bottomView === "split".
  const [consoleSplitLeftWidth, setConsoleSplitLeftWidth] = useState<number | null>(null);
  const consoleSplitDragRef = useRef({ x: 0, width: 0 });
  const consoleSplitRowRef = useRef<HTMLDivElement | null>(null);

  const onConsoleSplitResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const rowWidth = consoleSplitRowRef.current?.clientWidth ?? SPLIT_MIN_WIDTH * 2;
    const startWidth = consoleSplitLeftWidth ?? rowWidth / 2;
    consoleSplitDragRef.current = { x: e.clientX, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onConsoleSplitResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - consoleSplitDragRef.current.x;
    const maxWidth = (consoleSplitRowRef.current?.clientWidth ?? SPLIT_MIN_WIDTH * 2) - SPLIT_MIN_WIDTH;
    const next = Math.min(maxWidth, Math.max(SPLIT_MIN_WIDTH, consoleSplitDragRef.current.width + delta));
    setConsoleSplitLeftWidth(next);
  };

  // null = not yet customized - the left pane stays a true, responsive 50%
  // of the row (via flex-basis: 50%) rather than a fixed pixel amount, so it
  // stays 50/50 across window resizes until the user actually drags the
  // resizer, at which point it becomes a fixed px width like before.
  const [splitLeftWidth, setSplitLeftWidth] = useState<number | null>(null);
  const splitDragRef = useRef({ x: 0, width: 0 });
  const splitRowRef = useRef<HTMLDivElement | null>(null);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { y: e.clientY, height: consoleHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    // Dragging the handle up should grow the console (it sits below the
    // visualizer/editor), so height moves opposite to the pointer's Y delta.
    const delta = dragStartRef.current.y - e.clientY;
    const next = Math.min(CONSOLE_MAX_HEIGHT, Math.max(CONSOLE_MIN_HEIGHT, dragStartRef.current.height + delta));
    setConsoleHeight(next);
  };

  const onSplitResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // First drag ever (splitLeftWidth still null, meaning "true 50%") needs
    // a real starting px value to compute deltas from - read the row's
    // actual current width rather than assuming one.
    const rowWidth = splitRowRef.current?.clientWidth ?? SPLIT_MIN_WIDTH * 2;
    const startWidth = splitLeftWidth ?? rowWidth / 2;
    splitDragRef.current = { x: e.clientX, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSplitResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - splitDragRef.current.x;
    const maxWidth = (splitRowRef.current?.clientWidth ?? SPLIT_MIN_WIDTH * 2) - SPLIT_MIN_WIDTH;
    const next = Math.min(maxWidth, Math.max(SPLIT_MIN_WIDTH, splitDragRef.current.width + delta));
    setSplitLeftWidth(next);
  };

  // The main nav doubles as the left-pane selector while split (it's "the
  // same buttons in the same place" the user already knows from single-view
  // mode), rather than adding a whole separate control for it.
  const onSelectMainNav = (key: string | null) => {
    if (!key) return;
    if (key === "split") {
      // Tapping Split again while already split collapses back to a single
      // full panel showing whatever's currently on the left, rather than
      // being a dead end with no way back to single-view mode.
      setView(isSplit ? splitLeft : "split");
      return;
    }
    if (isSplit) {
      dispatch(uiActions.setSplitLeft(key as PaneContent));
    } else {
      setView(key as CenterView);
    }
  };

  const leftBasis = splitLeftWidth === null ? "50%" : `${splitLeftWidth}px`;

  const contentStyle = (content: PaneContent): React.CSSProperties => {
    if (!isSplit) return {};
    if (content === splitLeft) return { order: 1, flex: `0 0 ${leftBasis}` };
    if (content === splitRight) return { order: 3, flex: "1 1 auto" };
    return {};
  };

  const isVisible = (content: PaneContent) => (isSplit ? content === splitLeft || content === splitRight : view === content);

  return (
    <div className="centerPanel">
      <div className="centerPanelTop">
        {/* Left-pane selector, right-pane selector (only while split), and
            the Split toggle all sit on one row. The left/right nav groups
            get the exact same order/flex-basis as the content panes below
            (contentStyle()) - not a spacer sized to "match" the left pane,
            which drifted out of alignment by however wide the left nav's
            own labels happened to render (a real bug: a spacer can't know
            that width without measuring it, so it never actually matched).
            Reusing the identical values guarantees the right nav starts at
            precisely the same x as the right pane, unconditionally. */}
        <div className="centerPanelNavRow">
          <Nav
            variant="pills"
            activeKey={isSplit ? splitLeft : view}
            onSelect={onSelectMainNav}
            className="centerPanelMainNav"
            style={isSplit ? { order: 1, flex: `0 0 ${leftBasis}` } : undefined}
          >
            {topPaneLabels.map((p) => (
              <Nav.Item key={p.content}>
                <Nav.Link eventKey={p.content}>{p.label}</Nav.Link>
              </Nav.Item>
            ))}
          </Nav>

          {isSplit && (
            <>
              <div className="centerPanelNavRowResizerSpace" style={{ order: 2 }} />
              <Nav
                variant="pills"
                activeKey={splitRight}
                onSelect={(key) => key && dispatch(uiActions.setSplitRight(key as PaneContent))}
                className="centerPanelRightNav"
                style={{ order: 3, flex: "1 1 auto" }}
              >
                {topPaneLabels.map((p) => (
                  <Nav.Item key={p.content}>
                    <Nav.Link eventKey={p.content}>{p.label}</Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
            </>
          )}

          {/* activeKey here is purely this Nav's own pill-highlight display -
              onSelect below still fires with eventKey="split" regardless of
              it, so this doesn't touch onSelectMainNav's actual routing
              logic (that still keys off isSplit/splitLeft/view exactly as
              before). Matches the console split's own Nav+icon treatment. */}
          <Nav
            variant="pills"
            activeKey={isSplit ? "split" : undefined}
            onSelect={onSelectMainNav}
            className="centerPanelSplitNav"
            style={isSplit ? { order: 4 } : undefined}
          >
            <Nav.Item>
              <Nav.Link eventKey="split">
                <FontAwesomeIcon icon={faColumns} /> Split
              </Nav.Link>
            </Nav.Item>
          </Nav>
        </div>

        {/* All four stay mounted always so switching tabs or split assignment
            never resets the 3D camera, reloads/re-fetches the editor's
            content, or discards in-progress macro edits - only which pane
            (if any) a component is visually placed into changes, via the
            order/flex-basis in contentStyle(). */}
        <div className={"centerPanelContentRow " + (isSplit ? "split" : "")} ref={splitRowRef}>
          <div className="centerPanelContent" style={contentStyle("visualize")} hidden={!isVisible("visualize")}>
            <Visualizer3D />
          </div>
          {/* Portal target, not a direct <GcodeEditor/> render - see the
              activeEditSlot comment above. Hidden defensively whenever the
              bottom panel owns the editor too, on top of it never being
              selectable via topPaneLabels in that case. */}
          <div
            className="centerPanelContent"
            style={contentStyle("edit")}
            hidden={bottomView !== "console" || !isVisible("edit")}
            ref={setTopEditSlot}
          />
          {isSplit && (
            <div
              className="centerPanelSplitResizer"
              style={{ order: 2 }}
              onPointerDown={onSplitResizeStart}
              onPointerMove={onSplitResizeMove}
              title="Drag to resize the split"
            />
          )}
          <div className="centerPanelContent" style={contentStyle("macros")} hidden={!isVisible("macros")}>
            <MacroEditor compact={isSplit} />
          </div>
          <div className="centerPanelContent" style={contentStyle("probe")} hidden={!isVisible("probe")}>
            <ProbePanel compact={isSplit} />
          </div>
        </div>
      </div>

      <div
        className="centerPanelResizer"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        title="Drag to resize the console"
      />
      <div className="centerPanelConsole" style={{ flexBasis: consoleHeight }}>
        <div className="centerPanelConsoleHeader">
          <h6 className="centerPanelHeading">
            {bottomView === "edit" ? "Edit" : bottomView === "split" ? "Console + Edit" : "Console"}
          </h6>
          <div className="centerPanelConsoleHeaderRight">
            {/* Only meaningful (and only shown) while the bottom panel isn't
                split - while split, both are always shown together, so
                there's nothing to pick between (see isBottomSplit below). */}
            {!isBottomSplit && (
              <Nav
                variant="pills"
                activeKey={bottomView}
                onSelect={(key) => key && dispatch(uiActions.setBottomView(key as BottomView))}
                className="centerPanelBottomViewNav"
              >
                <Nav.Item>
                  <Nav.Link eventKey="console">Console</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="edit">Edit</Nav.Link>
                </Nav.Item>
              </Nav>
            )}
            {/* Same Nav/pills treatment as the top pane system's own Split
                link (blue text, pill-highlighted while active) rather than a
                bordered Button, so the two read as the same kind of control. */}
            <Nav
              variant="pills"
              activeKey={isBottomSplit ? "split" : undefined}
              onSelect={() => dispatch(uiActions.setBottomView(isBottomSplit ? "console" : "split"))}
              className="centerPanelConsoleSplitNav"
            >
              <Nav.Item>
                <Nav.Link
                  eventKey="split"
                  title={isBottomSplit ? "Show one at a time" : "Split: show the gcode editor alongside the console"}
                >
                  <FontAwesomeIcon icon={faColumns} /> Split
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </div>
        </div>
        <div className={"centerPanelConsoleBody" + (isBottomSplit ? " split" : "")} ref={consoleSplitRowRef}>
          <div
            className="centerPanelConsolePane"
            hidden={bottomView === "edit"}
            style={isBottomSplit ? { flex: `0 0 ${consoleSplitLeftWidth === null ? "50%" : `${consoleSplitLeftWidth}px`}` } : undefined}
          >
            <ConsolePanel />
          </div>
          {isBottomSplit && (
            <div
              className="centerPanelSplitResizer"
              onPointerDown={onConsoleSplitResizeStart}
              onPointerMove={onConsoleSplitResizeMove}
              title="Drag to resize the split"
            />
          )}
          {/* Always mounted (see activeEditSlot above), just hidden unless
              the bottom panel currently owns the editor, so its ref stays
              stable across toggling. */}
          <div className="centerPanelContent" hidden={bottomView === "console"} ref={setBottomEditSlot} />
        </div>
      </div>
      {createPortal(<GcodeEditor />, editorHostRef.current!)}
    </div>
  );
};

export default CenterPanel;
