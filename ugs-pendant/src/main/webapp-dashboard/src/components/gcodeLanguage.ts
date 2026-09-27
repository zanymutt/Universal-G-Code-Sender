import { StreamLanguage } from "@codemirror/language";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// A small hand-written tokenizer for gcode - there's no off-the-shelf CodeMirror
// language for it. Recognizes comments, line numbers, G/M-codes and axis/parameter words.
export const gcodeLanguage = StreamLanguage.define<null>({
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match(/^;.*/)) return "comment";
    if (stream.match(/^\([^)]*\)?/)) return "comment";
    if (stream.match(/^[Nn]\d+/)) return "meta";
    if (stream.match(/^[GgMm]\d+(\.\d+)?/)) return "keyword";
    if (stream.match(/^[A-Za-z]-?\d*\.?\d+/)) return "number";

    stream.next();
    return null;
  },
});

export const gcodeHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--dashboard-text-subtle)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--dashboard-text-muted)" },
  { tag: tags.keyword, color: "var(--dashboard-info)", fontWeight: "bold" },
  { tag: tags.number, color: "var(--dashboard-accent)" },
]);

export const gcodeSyntaxHighlighting = syntaxHighlighting(gcodeHighlightStyle);
