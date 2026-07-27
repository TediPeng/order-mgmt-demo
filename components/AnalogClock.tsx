"use client";

import { useEffect, useState } from "react";

export function AnalogClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return <div className="mx-auto h-56 w-56 animate-pulse rounded-full bg-slate-100" />;
  }

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hour12 = hours % 12;

  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hour12 * 30 + minutes * 0.5;

  const ampm = hours >= 12 ? "PM" : "AM";
  const digital = `${String(hour12 === 0 ? 12 : hour12).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")} ${ampm}`;
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const ticks = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-56 w-56 rounded-full border-4 border-slate-200 bg-white shadow-inner">
        {ticks.map((i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 h-full w-full"
            style={{ transform: `translate(-50%, -50%) rotate(${i * 30}deg)` }}
          >
            <div
              className={`absolute left-1/2 top-1 -translate-x-1/2 rounded-full ${
                i % 3 === 0 ? "h-2.5 w-1 bg-slate-500" : "h-1.5 w-0.5 bg-slate-300"
              }`}
            />
          </div>
        ))}
        {/* Hour hand */}
        <div
          className="absolute left-1/2 top-1/2 h-16 w-1.5 origin-bottom rounded-full bg-slate-800"
          style={{ transform: `translate(-50%, -100%) rotate(${hourDeg}deg)` }}
        />
        {/* Minute hand */}
        <div
          className="absolute left-1/2 top-1/2 h-24 w-1 origin-bottom rounded-full bg-slate-600"
          style={{ transform: `translate(-50%, -100%) rotate(${minuteDeg}deg)` }}
        />
        {/* Second hand */}
        <div
          className="absolute left-1/2 top-1/2 h-24 w-0.5 origin-bottom rounded-full bg-[var(--brand-primary)]"
          style={{ transform: `translate(-50%, -100%) rotate(${secondDeg}deg)` }}
        />
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand-primary)]" />
      </div>
      <p className="mt-4 text-2xl font-semibold tabular-nums text-slate-900">{digital}</p>
      <p className="text-sm text-slate-500">{dateLabel}</p>
      <p className="mt-1 text-xs text-slate-400">Device local time — attendance is recorded using server time.</p>
    </div>
  );
}
