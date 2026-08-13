"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Spreadsheet keys for a plain HTML table.
 *
 * The leads tables are seventeen columns of data an agent reads all day, and
 * until now the only way through them was the mouse and the scrollbar. This is
 * the part of a spreadsheet that is actually worth having here — moving, and
 * copying out — without turning a live, Pancake-synced table into an editable
 * grid, which the call-session rule would have to be broken to allow.
 *
 * Deliberately DOM-driven for the copy: the text put on the clipboard is read
 * from the cells themselves, so it is exactly what is on screen. A parallel
 * model of "what each cell says" would be a second thing to keep true, and the
 * first time it drifted the paste would be wrong in a way nobody would notice.
 */
export interface GridKeys {
  /** Row/column of the cell cursor, or null when nothing is selected. */
  cursor: { row: number; col: number } | null;
  setCursor: (next: { row: number; col: number } | null) => void;
  /**
   * Spread onto the scroll container — that is the whole integration.
   *
   * The cursor is painted by setting `data-active` on the cell in an effect
   * rather than by a prop on each `<td>`. Both tables hand-write seventeen
   * cells per row; threading a row and column index through every one of them
   * would be thirty-four edits to maintain, and a column inserted later would
   * break the numbering silently. The DOM already knows where every cell is.
   */
  containerProps: {
    ref: React.RefObject<HTMLDivElement>;
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  };
}

export function useGridKeys({
  rowCount,
  onEnter,
  enabled = true,
}: {
  rowCount: number;
  /** Enter on a row — opening the lead, in both tables. */
  onEnter: (row: number) => void;
  /** Off while a popup owns the keyboard. */
  enabled?: boolean;
}): GridKeys {
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);

  // Counted from the table rather than passed in. A column added to the header
  // and forgotten here would silently make the last column unreachable, and the
  // table already knows how many it has.
  const columnCount = () => ref.current?.querySelector("tbody tr")?.querySelectorAll("td").length ?? 1;

  // A cursor left pointing past the end after a filter or a page change reads
  // as the table having lost your place; dropping it is honest.
  useEffect(() => {
    setCursor((c) => (c && c.row >= rowCount ? null : c));
  }, [rowCount]);

  /** The row under the cursor, as a tab-separated line — one paste, N cells. */
  const copyRow = useCallback((row: number) => {
    const tr = ref.current?.querySelectorAll("tbody tr")[row];
    if (!tr) return;
    const text = Array.from(tr.querySelectorAll("td"))
      .map((td) => (td.textContent || "").trim().replace(/\s+/g, " "))
      // A tab inside a cell would split it into two on paste; there are none in
      // this data, but the guard costs nothing and the failure would be silent.
      .map((s) => s.replace(/\t/g, " "))
      .join("\t");
    void navigator.clipboard?.writeText(text);
  }, []);

  /** Keeps the moved-to cell in view inside the table's own scroll box. */
  const revealCell = useCallback((row: number, col: number) => {
    const cell = ref.current?.querySelectorAll("tbody tr")[row]?.querySelectorAll("td")[col];
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enabled || rowCount === 0) return;
      // Never steal keys from something being typed into.
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;

      const current = cursor ?? { row: 0, col: 0 };
      const colCount = columnCount();
      const move = (row: number, col: number) => {
        const next = {
          row: Math.max(0, Math.min(rowCount - 1, row)),
          col: Math.max(0, Math.min(colCount - 1, col)),
        };
        setCursor(next);
        revealCell(next.row, next.col);
        e.preventDefault();
      };

      switch (e.key) {
        case "ArrowDown":
          return move(current.row + 1, current.col);
        case "ArrowUp":
          return move(current.row - 1, current.col);
        case "ArrowRight":
          return move(current.row, current.col + 1);
        case "ArrowLeft":
          return move(current.row, current.col - 1);
        case "Home":
          return move(e.ctrlKey ? 0 : current.row, 0);
        case "End":
          return move(e.ctrlKey ? rowCount - 1 : current.row, colCount - 1);
        case "PageDown":
          return move(current.row + 10, current.col);
        case "PageUp":
          return move(current.row - 10, current.col);
        case "Enter":
          if (cursor) {
            onEnter(cursor.row);
            e.preventDefault();
          }
          return;
        case "c":
        case "C":
          if ((e.ctrlKey || e.metaKey) && cursor) {
            copyRow(cursor.row);
            e.preventDefault();
          }
          return;
        case "Escape":
          setCursor(null);
          return;
        default:
      }
    },
    [enabled, rowCount, cursor, onEnter, copyRow, revealCell]
  );

  /** Clicking a cell puts the cursor there, so the mouse and the keys agree
   * about where you are. Controls inside the cell keep their own click. */
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const td = (e.target as HTMLElement).closest("td");
    const tr = td?.closest("tr");
    if (!td || !tr || !tr.parentElement || tr.parentElement.tagName !== "TBODY") return;
    const row = Array.from(tr.parentElement.children).indexOf(tr);
    setCursor({ row, col: (td as HTMLTableCellElement).cellIndex });
  }, []);

  // Paint the cursor. `data-active` is styled once in globals.css, so neither
  // table needs a class on any cell.
  useEffect(() => {
    const cells = ref.current?.querySelectorAll("tbody td[data-active]");
    cells?.forEach((c) => c.removeAttribute("data-active"));
    if (!cursor) return;
    const cell = ref.current?.querySelectorAll("tbody tr")[cursor.row]?.querySelectorAll("td")[cursor.col];
    cell?.setAttribute("data-active", "true");
  });

  return {
    cursor,
    setCursor,
    // No role="grid": that contract wants row/gridcell roles on every element
    // beneath it, and claiming it without them tells a screen reader something
    // untrue. This is a focusable scroll box over an ordinary table.
    containerProps: { ref, tabIndex: 0, onKeyDown, onClick },
  };
}
