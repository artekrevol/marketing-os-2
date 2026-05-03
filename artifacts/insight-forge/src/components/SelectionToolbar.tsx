import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Wand2, Scissors, ListPlus, ArrowRightLeft, Sparkles, MessageSquareQuote } from "lucide-react";
import { createPortal } from "react-dom";

export interface SelectionAction {
  id: string;
  label: string;
  icon: typeof Wand2;
  // Builds an instruction sent to the existing draft-section revision pipeline.
  // The selection is included verbatim so the AI replaces the exact range.
  buildInstruction: (selection: string) => string;
}

// We wrap selections in unique XML-style sentinels and never use a delimiter
// that could appear in normal prose. Selections are normalized so that any
// stray sentinel-looking text inside the passage can't break out of the block.
const OPEN_TAG = "<PASSAGE>";
const CLOSE_TAG = "</PASSAGE>";
function wrapSelection(sel: string): string {
  // Defang any literal occurrence of our sentinels inside the passage so the
  // model can't misread the boundaries. Vanishingly unlikely, but cheap.
  const safe = sel.replace(/<\/?PASSAGE>/g, "[passage-tag]");
  return `${OPEN_TAG}\n${safe}\n${CLOSE_TAG}`;
}

export const SELECTION_ACTIONS: SelectionAction[] = [
  {
    id: "tighten",
    label: "Tighten",
    icon: Scissors,
    buildInstruction: (sel) =>
      `Replace ONLY the passage between ${OPEN_TAG} and ${CLOSE_TAG} below with a tighter version (cut filler, trim adverbs, prefer active voice, target ~30% fewer words). Keep the meaning, citations, and tone identical. Do not change anything else in the draft. Do not include the sentinel tags in your output.\n\n${wrapSelection(sel)}`,
  },
  {
    id: "expand",
    label: "Expand",
    icon: ListPlus,
    buildInstruction: (sel) =>
      `Replace ONLY the passage between ${OPEN_TAG} and ${CLOSE_TAG} below with an expanded version (add one concrete example, statistic, or short anecdote that reinforces the existing claim — only if you can support it from the project's research). Keep the same tone and any existing citations. Do not change anything else in the draft. Do not include the sentinel tags in your output.\n\n${wrapSelection(sel)}`,
  },
  {
    id: "active",
    label: "Active voice",
    icon: ArrowRightLeft,
    buildInstruction: (sel) =>
      `Rewrite ONLY the passage between ${OPEN_TAG} and ${CLOSE_TAG} below in clear active voice. Keep meaning, length (within ±10%), citations, and tone the same. Do not change anything else in the draft. Do not include the sentinel tags in your output.\n\n${wrapSelection(sel)}`,
  },
  {
    id: "example",
    label: "Add example",
    icon: Sparkles,
    buildInstruction: (sel) =>
      `Append one concrete, citable example sentence to the passage between ${OPEN_TAG} and ${CLOSE_TAG} below that grounds the claim in a specific scenario, customer, or number. Use only research already in the project. Do not change the existing prose inside the passage. Do not change anything else in the draft. Do not include the sentinel tags in your output.\n\n${wrapSelection(sel)}`,
  },
  {
    id: "counter",
    label: "Counter-argument",
    icon: MessageSquareQuote,
    buildInstruction: (sel) =>
      `Add a single sentence after the passage between ${OPEN_TAG} and ${CLOSE_TAG} below that names the strongest reasonable objection to the claim and concedes or addresses it. Stay in the same voice. Do not change the existing prose inside the passage. Do not change anything else in the draft. Do not include the sentinel tags in your output.\n\n${wrapSelection(sel)}`,
  },
];

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  disabled?: boolean;
  onAction: (action: SelectionAction, selection: string) => void;
}

interface Anchor {
  top: number;
  left: number;
  selection: string;
}

const MIN_SELECTION_LEN = 12;

export default function SelectionToolbar({ textareaRef, text, disabled, onAction }: Props) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Recompute anchor whenever the user's selection changes inside our textarea.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const update = () => {
      if (document.activeElement !== ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end) {
        setAnchor(null);
        return;
      }
      const selection = ta.value.slice(start, end).trim();
      if (selection.length < MIN_SELECTION_LEN) {
        setAnchor(null);
        return;
      }
      // Position the toolbar near the start of the selection. We use the
      // textarea's bounding rect + line-height heuristic — DOM ranges aren't
      // available inside <textarea>, so we approximate. Good enough to land
      // the toolbar above the selected text.
      const rect = ta.getBoundingClientRect();
      const styles = window.getComputedStyle(ta);
      const lineHeight = parseFloat(styles.lineHeight) || 24;
      const paddingTop = parseFloat(styles.paddingTop) || 0;
      const before = ta.value.slice(0, start);
      const linesBefore = before.split("\n").length - 1;
      const top = rect.top + paddingTop + linesBefore * lineHeight - 44 - ta.scrollTop;
      const left = rect.left + 16;
      setAnchor({
        top: Math.max(8, top),
        left: Math.min(window.innerWidth - 380, left),
        selection,
      });
    };

    const onSelect = () => requestAnimationFrame(update);
    const onBlur = (e: FocusEvent) => {
      // Don't dismiss if focus moves into the toolbar itself.
      if (toolbarRef.current && e.relatedTarget instanceof Node && toolbarRef.current.contains(e.relatedTarget)) {
        return;
      }
      setAnchor(null);
    };

    ta.addEventListener("select", onSelect);
    ta.addEventListener("keyup", onSelect);
    ta.addEventListener("mouseup", onSelect);
    ta.addEventListener("scroll", onSelect);
    ta.addEventListener("blur", onBlur);
    window.addEventListener("resize", onSelect);
    return () => {
      ta.removeEventListener("select", onSelect);
      ta.removeEventListener("keyup", onSelect);
      ta.removeEventListener("mouseup", onSelect);
      ta.removeEventListener("scroll", onSelect);
      ta.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onSelect);
    };
  }, [textareaRef, text]);

  // When the user clicks anywhere outside the textarea + toolbar, close.
  useLayoutEffect(() => {
    if (!anchor) return;
    const onDocDown = (e: MouseEvent) => {
      const ta = textareaRef.current;
      const tb = toolbarRef.current;
      const tgt = e.target as Node;
      if (ta?.contains(tgt) || tb?.contains(tgt)) return;
      setAnchor(null);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [anchor, textareaRef]);

  if (!anchor || disabled) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      style={{ position: "fixed", top: anchor.top, left: anchor.left, zIndex: 60 }}
      className="bg-ink text-paper rounded-sm shadow-lg border border-ink/20 px-1 py-1 flex items-center gap-0.5"
      // Prevent textarea blur when clicking the toolbar so selection survives.
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="text-[10px] uppercase tracking-widest opacity-60 px-2 py-1">
        AI assist
      </span>
      <span className="w-px h-5 bg-paper/20 mx-0.5" />
      {SELECTION_ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.id}
            onClick={() => onAction(a, anchor.selection)}
            className="text-[11px] px-2 py-1 rounded-sm hover:bg-paper/10 inline-flex items-center gap-1 transition-colors"
            title={`${a.label} — replace selected passage via AI revision`}
          >
            <Icon className="h-3 w-3" />
            {a.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
