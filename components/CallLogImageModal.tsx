"use client";

import { useEffect, useState } from "react";
import { Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDate, formatDateTime } from "@/lib/utils";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];

/** Full view of a call-log screenshot.
 *
 * The image is served through the access-checked route rather than a public
 * URL, so opening it in a new tab or full screen still goes through the same
 * permission check as the thumbnail did. */
export function CallLogImageModal({
  image,
  agentLabel,
  onClose,
}: {
  image: { id: string; original_filename: string; uploaded_at: string; related_call_date: string | null };
  agentLabel: string;
  onClose: () => void;
}) {
  const [zoomIndex, setZoomIndex] = useState(2); // 1x
  const src = `/api/call-log-images/${image.id}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const zoom = ZOOM_STEPS[zoomIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Call log screenshot"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-section-title text-slate-900">{image.original_filename}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {agentLabel} · uploaded {formatDateTime(image.uploaded_at)}
              {image.related_call_date ? ` · calls of ${formatDate(image.related_call_date)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          {/* Access-checked route, not a public URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Call log screenshot uploaded by ${agentLabel}`}
            style={{ width: `${zoom * 100}%` }}
            className="mx-auto max-w-none rounded shadow-sm transition-[width] duration-150"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={zoomIndex === 0}
              onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={src} target="_blank" rel="noopener noreferrer">
              <Button type="button" size="sm" variant="outline">
                <Maximize2 className="h-4 w-4" /> Full screen
              </Button>
            </a>
            <a href={src} download={image.original_filename}>
              <Button type="button" size="sm" variant="outline">
                <Download className="h-4 w-4" /> Download
              </Button>
            </a>
            <Button type="button" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
