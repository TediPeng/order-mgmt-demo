"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The left offset for a second frozen column, measured from the first one.
 *
 * A fixed `left-[7rem]` does not work here. The tables carry `min-w-[2650px]`,
 * and when the sum of the columns' natural widths is less than that, the browser
 * shares the surplus out across every column — the frozen ones included. So the
 * first column renders wider than the width it was given, the second column is
 * still pinned at the width it was promised, and the two overlap: the id sits
 * under the status, and neither can be read or clicked.
 *
 * Measuring the header cell instead means the offset is whatever the column
 * actually became, at whatever window size, in whatever font. The observer keeps
 * it true through a resize or a zoom.
 */
export function useFrozenOffset<T extends HTMLElement = HTMLTableCellElement>() {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOffset(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, offset };
}
