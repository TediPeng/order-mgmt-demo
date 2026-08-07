"use client";

import { useEffect, useRef } from "react";

/** The decorative half of the sign-in screen: a field of dots with a few
 * connections tracing across it.
 *
 * Adapted from a component that drew world-travel routes over a map of the
 * continents. That shape means nothing here, so the silhouette is gone and
 * what is left is the part that reads well behind a logo: quiet movement,
 * brand gold, no message of its own.
 *
 * Canvas rather than DOM because this is a few hundred dots repainting every
 * frame -- as elements it would be a few hundred nodes the browser has to lay
 * out, on the one page every user sees before they have done anything.
 */

const DOT_GAP = 14;
const BRAND = "143, 102, 12"; // --brand-primary
const ACCENT = "240, 192, 0"; // --brand-accent

interface Route {
  from: [number, number];
  to: [number, number];
  delay: number;
}

/** Normalised (0-1) so the routes sit in the same relative places whatever
 * the panel's actual size is. */
const ROUTES: Route[] = [
  { from: [0.18, 0.62], to: [0.45, 0.3], delay: 0 },
  { from: [0.45, 0.3], to: [0.78, 0.44], delay: 1.6 },
  { from: [0.14, 0.24], to: [0.38, 0.72], delay: 0.8 },
  { from: [0.82, 0.2], to: [0.55, 0.76], delay: 2.4 },
];

const CYCLE_SECONDS = 12;
const TRAVEL_SECONDS = 3;

export function LoginAside() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Someone who has asked their system for less motion gets the dots and the
    // finished lines, painted once.
    const stillOnly = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dots: { x: number; y: number; alpha: number }[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let start = performance.now();

    const layout = () => {
      const dpr = window.devicePixelRatio || 1;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      for (let x = DOT_GAP; x < width; x += DOT_GAP) {
        for (let y = DOT_GAP; y < height; y += DOT_GAP) {
          // Thinned out at random so the grid reads as texture rather than
          // graph paper, and faded toward the edges so it has no hard border.
          if (Math.random() > 0.55) continue;
          const edge = Math.min(x, width - x, y, height - y);
          const falloff = Math.min(1, edge / 90);
          dots.push({ x, y, alpha: (Math.random() * 0.35 + 0.12) * falloff });
        }
      }
    };

    const paint = (now: number) => {
      const elapsed = stillOnly ? CYCLE_SECONDS : ((now - start) / 1000) % CYCLE_SECONDS;
      ctx.clearRect(0, 0, width, height);

      for (const dot of dots) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${BRAND}, ${dot.alpha})`;
        ctx.fill();
      }

      for (const route of ROUTES) {
        const t = Math.min(Math.max((elapsed - route.delay) / TRAVEL_SECONDS, 0), 1);
        if (t <= 0) continue;

        const ax = route.from[0] * width;
        const ay = route.from[1] * height;
        const bx = route.to[0] * width;
        const by = route.to[1] * height;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(${BRAND}, 0.45)`;
        ctx.lineWidth = 1.25;
        ctx.stroke();

        for (const [px, py] of [[ax, ay] as const, [x, y] as const]) {
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${BRAND}, 0.9)`;
          ctx.fill();
        }

        // A soft halo on the leading point only, so the eye follows movement
        // rather than reading four equally bright dots.
        if (t < 1) {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${ACCENT}, 0.25)`;
          ctx.fill();
        }
      }

      if (!stillOnly) frame = requestAnimationFrame(paint);
    };

    const observer = new ResizeObserver(() => {
      layout();
      if (stillOnly) paint(performance.now());
    });
    observer.observe(parent);

    layout();
    start = performance.now();
    frame = requestAnimationFrame(paint);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
}
