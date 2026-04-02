import { useState } from "react";
import type { FileDetails } from "../app/types";
import { iconForKind } from "./icons";
import { HighlightedSnippet } from "./results";
import { cx, pageNumberFromSource } from "../lib/appHelpers";

export interface SelectedFilePreviewProps {
  file: FileDetails;
  previewUrl: string | null;
  query: string;
  className: string;
}

export function SelectedFilePreview({
  file,
  previewUrl,
  query,
  className,
}: SelectedFilePreviewProps) {
  const previewType = getPreviewType(file, previewUrl);
  const pdfPage = pageNumberFromSource(file.contentSource);
  const pdfPreviewUrl =
    previewType === "pdf" && previewUrl
      ? `${previewUrl}#page=${pdfPage}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`
      : previewUrl;

  if (previewType === "image") {
    return (
      <ImagePreviewPanel file={file} previewUrl={previewUrl} className={className} />
    );
  }

  if (previewType === "pdf") {
    return (
      <div className={cx("relative overflow-hidden bg-[#eef0f6]", className)}>
        <iframe
          src={pdfPreviewUrl ?? undefined}
          title={file.name}
          className="h-full w-full border-0 bg-white"
        />
        <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-full bg-white/88 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#5e657f] shadow-[0_10px_24px_rgba(20,20,30,0.08)]">
          {file.contentSource ? `${file.contentSource} preview` : `Page ${pdfPage} preview`}
        </div>
      </div>
    );
  }

  if (file.contentSnippet || file.semanticSummary) {
    return (
      <div
        className={cx(
          "overflow-hidden rounded-[24px] border border-black/5 bg-[#fbfaf7] p-5",
          className,
        )}
      >
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
          Document preview
        </p>
        <HighlightedSnippet
          className="mt-4 text-sm leading-7 text-[#505854]"
          text={file.contentSnippet ?? file.semanticSummary ?? file.name}
          query={query}
        />
        {file.contentSource ? (
          <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[#7c8187]">
            {file.contentSource}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cx("grid place-items-center bg-[#eef0f6] text-[#737792]", className)}>
      {iconForKind(file.kind)}
    </div>
  );
}

function getPreviewType(file: FileDetails, previewUrl: string | null) {
  if (!previewUrl) {
    return "none";
  }

  if (file.kind === "image") {
    return "image";
  }

  if (file.extension.toLowerCase() === "pdf") {
    return "pdf";
  }

  return "none";
}

interface ImagePreviewPanelProps {
  file: FileDetails;
  previewUrl: string | null;
  className: string;
}

function ImagePreviewPanel({
  file,
  previewUrl,
  className,
}: ImagePreviewPanelProps) {
  const [zoom, setZoom] = useState(1);

  return (
    <div
      className={cx(
        "relative overflow-hidden bg-[radial-gradient(circle_at_top,rgba(228,231,250,0.45),transparent_55%),#eef0f6]",
        className,
      )}
    >
      <img
        src={previewUrl ?? undefined}
        alt={file.name}
        className="h-full w-full object-contain transition-transform duration-200"
        style={{ transform: `scale(${zoom})` }}
      />
      <div className="absolute bottom-4 left-4 right-4 rounded-[18px] bg-white/86 p-3 shadow-[0_18px_30px_rgba(40,40,60,0.12)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
            Image zoom
          </span>
          <span className="text-sm font-medium text-[#2c332f]">{zoom.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-3 w-full accent-[#737792]"
        />
      </div>
    </div>
  );
}
