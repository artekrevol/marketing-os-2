import { useEffect, useMemo, useRef, useState } from "react";
import { useTagVocab } from "@/lib/useTagVocab";

type Props = {
  brandId: string | null;
  existing: string[];
  onAdd: (tag: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Keyword tag input with autocomplete drawn from the shared tag vocabulary
 * (union of Reviews Bank + Named Projects usage, ranked by count descending).
 *
 * - Arrow Up/Down to navigate suggestions
 * - Enter or comma to confirm (either selected suggestion or free-form text)
 * - Click a suggestion to add it instantly
 * - Blurring auto-commits any uncommitted text so Save never loses a typed tag
 * - Already-added tags are excluded from suggestions
 * - Suggestion count badge shows usage frequency (higher = ranked first)
 */
export function TagAutocompleteInput({
  brandId,
  existing,
  onAdd,
  placeholder = "Type a keyword, press Enter or comma to add",
  className,
}: Props) {
  const { vocab } = useTagVocab(brandId);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return vocab
      .filter((e) => !existing.includes(e.tag) && e.tag.toLowerCase().includes(q))
      .slice(0, 8);
  }, [input, vocab, existing]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const commitText = (raw: string) => {
    const tags = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of tags) {
      if (!existing.includes(t)) onAdd(t);
    }
    setInput("");
    setOpen(false);
    setActiveIdx(-1);
  };

  const selectSuggestion = (tag: string) => {
    if (!existing.includes(tag)) onAdd(tag);
    setInput("");
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (activeIdx >= 0 && suggestions[activeIdx]) {
              selectSuggestion(suggestions[activeIdx].tag);
            } else {
              commitText(input);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setActiveIdx(-1);
          }
        }}
        onFocus={() => {
          if (input.trim()) setOpen(true);
        }}
        onBlur={() => {
          if (input.trim()) commitText(input);
          setOpen(false);
        }}
        placeholder={placeholder}
        className={
          className ??
          "w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm"
        }
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-background border border-rule rounded-sm shadow-lg max-h-52 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li
              key={s.tag}
              className={`flex items-center justify-between px-2 py-1.5 cursor-pointer text-sm select-none ${
                i === activeIdx ? "bg-secondary" : "hover:bg-secondary"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(s.tag);
              }}
            >
              <span>{s.tag}</span>
              <span className="text-xs text-ink-muted tabular-nums">{s.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
