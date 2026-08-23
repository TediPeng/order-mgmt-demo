"use client";

import { useRef, useState } from "react";
import { List, X } from "lucide-react";
import { Input, Textarea } from "@/components/ui/Field";
import { MAX_SEARCH_TERMS } from "@/lib/leads-query-terms";

/**
 * The Leads search box, which also takes a list.
 *
 * One box did one thing at a time: find this order, or find this customer. But
 * the question people actually arrive with is a column out of a spreadsheet —
 * thirty order ids a supplier queried, or the numbers from a courier report —
 * and answering it one lookup at a time is thirty searches and thirty pages.
 *
 * A plain <input> cannot take that paste. Chrome strips the line breaks and
 * runs the values together, so pasting a column of ids produces one
 * meaningless number and a list with nothing in it. So the box notices a
 * multi-line paste and becomes a textarea, keeping the lines. Nothing has to
 * be switched on first: paste, and it is already in the right shape.
 *
 * Enter still searches while it is one line, because that is the habit. Once
 * it is a list, Enter belongs to the list and Ctrl+Enter searches — with the
 * button always there for anyone who does not know that.
 */
export function LeadSearchBox({
  defaultValue,
  placeholder,
}: {
  defaultValue?: string;
  placeholder: string;
}) {
  const initial = defaultValue || "";
  const [value, setValue] = useState(initial);
  /** List mode is entered by pasting one, or by asking for it — and it is
   * remembered on the way back, so a search made from a list of thirty comes
   * back as that list rather than as one long comma-separated line. */
  const [list, setList] = useState(/[,;\r\n]/.test(initial));
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const terms = value
    .split(/[,;\r\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const unique = new Set(terms).size;
  const capped = unique > MAX_SEARCH_TERMS;

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text");
    if (!/[\r\n]/.test(text.trim())) return; // ordinary paste, leave it alone
    e.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    setValue((prev) => {
      const head = prev.trim();
      return head ? `${head}\n${lines.join("\n")}` : lines.join("\n");
    });
    setList(true);
    // After the switch, so the element being focused exists.
    requestAnimationFrame(() => areaRef.current?.focus());
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        {list ? (
          <Textarea
            ref={areaRef}
            name="q"
            rows={Math.min(6, Math.max(2, terms.length))}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // Enter makes a new line here; Ctrl+Enter is the search.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={"One per line — order IDs, phone numbers or names"}
            className="font-mono text-xs leading-5"
            aria-label="Search leads by list"
          />
        ) : (
          <Input
            name="q"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={handlePaste}
            placeholder={placeholder}
          />
        )}
        <button
          type="button"
          onClick={() => setList((on) => !on)}
          title={list ? "Back to a single line" : "Search several at once — paste a column from Excel"}
          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
        >
          {list ? <X className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
          {list ? "Single" : "List"}
        </button>
      </div>

      {/* Only once it is genuinely a list. Saying "1 item" under every ordinary
          search would be noise in front of a control used all day. */}
      {unique > 1 && (
        <p className="mt-1 text-xs text-slate-500">
          Searching {Math.min(unique, MAX_SEARCH_TERMS)} items — a lead matching any of them is shown.
          {capped && (
            <span className="ml-1 font-medium text-amber-700">
              Only the first {MAX_SEARCH_TERMS} are used; {unique - MAX_SEARCH_TERMS} were left out.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
