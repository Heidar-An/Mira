import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode, type WheelEvent } from "react";
import { buttonClass } from "../app/constants";
import type { FileDetails } from "../app/types";
import { CloseIcon, ExpandIcon, MinusIcon, PlusIcon, iconForKind } from "./icons";
import { HighlightedSnippet } from "./results";
import { cx, pageNumberFromSource } from "../lib/appHelpers";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const previewType = getPreviewType(file, previewUrl);
  const pdfPage = pageNumberFromSource(file.contentSource);
  const pdfPreviewUrl =
    previewType === "pdf" && previewUrl
      ? `${previewUrl}#page=${pdfPage}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`
      : null;

  const expandButton = (
    <ExpandButton fileName={file.name} onOpen={() => setIsDialogOpen(true)} />
  );

  const dialogContent = previewType === "image"
    ? <ImageDialogContent file={file} previewUrl={previewUrl} />
    : previewType === "pdf"
      ? <PdfDialogContent file={file} pdfPreviewUrl={pdfPreviewUrl} pdfPage={pdfPage} />
      : (file.contentSnippet || file.semanticSummary)
        ? <DocumentDialogContent file={file} query={query} />
        : <FallbackDialogContent file={file} />;

  let inlinePreview: ReactNode;

  if (previewType === "image") {
    inlinePreview = (
      <ImageInlinePreview file={file} previewUrl={previewUrl} className={className}>
        {expandButton}
      </ImageInlinePreview>
    );
  } else if (previewType === "pdf") {
    inlinePreview = (
      <PdfInlinePreview
        file={file}
        previewUrl={pdfPreviewUrl}
        className={className}
        subtitle={file.contentSource ?? `Page ${pdfPage} preview`}
      >
        {expandButton}
      </PdfInlinePreview>
    );
  } else if (file.contentSnippet || file.semanticSummary) {
    inlinePreview = (
      <div
        className={cx(
          "relative overflow-hidden rounded-[24px] border border-black/5 bg-[#fbfaf7] p-5",
          className,
        )}
      >
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
          Document preview
        </p>
        <HighlightedSnippet
          className="mt-4 line-clamp-6 text-sm leading-7 text-[#505854]"
          text={file.contentSnippet ?? file.semanticSummary ?? file.name}
          query={query}
        />
        {file.contentSource ? (
          <p
            className="mt-4 truncate text-xs uppercase tracking-[0.14em] text-[#7c8187]"
            title={file.contentSource}
          >
            {file.contentSource}
          </p>
        ) : null}
        {expandButton}
      </div>
    );
  } else {
    inlinePreview = (
      <div className={cx("relative grid place-items-center bg-[#eef0f6] text-[#737792]", className)}>
        {iconForKind(file.kind)}
        {expandButton}
      </div>
    );
  }

  return (
    <>
      {inlinePreview}
      <FullscreenPreviewDialog
        file={file}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
      >
        {dialogContent}
      </FullscreenPreviewDialog>
    </>
  );
}

function getPreviewType(file: FileDetails, previewUrl: string | null) {
  if (!previewUrl) return "none";
  if (file.kind === "image") return "image";
  if (file.extension.toLowerCase() === "pdf") return "pdf";
  return "none";
}

// ---------------------------------------------------------------------------
// Expand button (shared across all inline previews)
// ---------------------------------------------------------------------------

function ExpandButton({ fileName, onOpen }: { fileName: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/88 text-[#43495b] shadow-[0_14px_28px_rgba(25,25,35,0.14)] transition hover:scale-[1.03] hover:bg-white"
      aria-label={`Open ${fileName} in fullscreen preview`}
      title="Open fullscreen preview"
    >
      <ExpandIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline image preview with trackpad zoom
// ---------------------------------------------------------------------------

function ImageInlinePreview({
  file,
  previewUrl,
  className,
  children,
}: {
  file: FileDetails;
  previewUrl: string | null;
  className: string;
  children?: ReactNode;
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom((current) =>
      clampZoom(current * Math.exp(-event.deltaY * 0.002)),
    );
  };

  return (
    <div
      className={cx(
        "relative overflow-hidden bg-[radial-gradient(circle_at_top,rgba(228,231,250,0.45),transparent_55%),#eef0f6]",
        className,
      )}
      onWheel={handleWheel}
    >
      <img
        src={previewUrl ?? undefined}
        alt={file.name}
        className="h-full w-full object-contain transition-transform duration-200"
        style={{ transform: `scale(${zoom})` }}
      />
      {children}
    </div>
  );
}

function PdfInlinePreview({
  file,
  previewUrl,
  className,
  subtitle,
  children,
}: {
  file: FileDetails;
  previewUrl: string | null;
  className: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-[24px] border border-black/5 bg-[radial-gradient(circle_at_top,rgba(228,231,250,0.3),transparent_55%),#eef0f6]",
        className,
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <iframe
          src={previewUrl ?? undefined}
          title={`${file.name} preview`}
          className="pointer-events-none h-[calc(100%+96px)] w-full border-0 bg-white"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#eef0f6] via-[#eef0f6]/92 to-transparent" />
      <div
        className="pointer-events-none absolute inset-x-4 bottom-4 truncate rounded-full bg-white/88 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#5e657f] shadow-[0_10px_24px_rgba(20,20,30,0.08)]"
        title={subtitle}
      >
        {subtitle}
      </div>

      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen dialog shell (shared across all preview types)
// ---------------------------------------------------------------------------

function FullscreenPreviewDialog({
  file,
  isOpen,
  onClose,
  children,
}: {
  file: FileDetails;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-[#11141d]/68 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${file.name} preview`}
    >
      <div className="flex h-full items-center justify-center">
        <div
          className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/12 bg-[#eef0f6] shadow-[0_30px_90px_rgba(16,18,26,0.42)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/88 text-[#43495b] shadow-[0_16px_32px_rgba(20,20,30,0.16)] transition hover:scale-[1.03] hover:bg-white"
            aria-label="Close fullscreen preview"
            title="Close"
          >
            <CloseIcon />
          </button>

          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Dialog content: Image (with zoom controls)
// ---------------------------------------------------------------------------

function ImageDialogContent({
  file,
  previewUrl,
}: {
  file: FileDetails;
  previewUrl: string | null;
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const updateZoom = (next: number | ((c: number) => number)) =>
    setZoom((c) => clampZoom(typeof next === "function" ? next(c) : next));

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    updateZoom((c) => c * Math.exp(-event.deltaY * 0.002));
  };

  return (
    <>
      <div className="min-h-0 flex-1 p-4 pt-18 sm:p-6 sm:pt-20">
        <div
          className="relative h-full min-h-[320px] overflow-hidden rounded-[26px] bg-[radial-gradient(circle_at_top,rgba(228,231,250,0.45),transparent_55%),#eef0f6]"
          onWheel={handleWheel}
        >
          <img
            src={previewUrl ?? undefined}
            alt={file.name}
            className="h-full w-full object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      </div>

      <div className="border-t border-black/5 bg-white/84 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#202724]">{file.name}</p>
            <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
              Pinch to zoom or use the controls
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => updateZoom((c) => c - ZOOM_STEP)}
              className="grid h-10 w-10 place-items-center rounded-full border border-black/8 bg-white/88 text-[#41485a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
            >
              <MinusIcon />
            </button>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => updateZoom(Number(e.target.value))}
              className="w-32 accent-[#737792] sm:w-40"
              aria-label="Zoom"
            />
            <button
              type="button"
              onClick={() => updateZoom((c) => c + ZOOM_STEP)}
              className="grid h-10 w-10 place-items-center rounded-full border border-black/8 bg-white/88 text-[#41485a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              onClick={() => updateZoom(MIN_ZOOM)}
              className={cx(buttonClass, "px-3 py-2.5")}
            >
              Reset
            </button>
            <span className="rounded-full bg-[#eef0f8] px-3 py-2 text-sm font-medium text-[#565d7c]">
              {zoomLabel}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog content: PDF
// ---------------------------------------------------------------------------

function PdfDialogContent({
  file,
  pdfPreviewUrl,
  pdfPage,
}: {
  file: FileDetails;
  pdfPreviewUrl: string | null;
  pdfPage: number;
}) {
  const fullPdfUrl = pdfPreviewUrl
    ? pdfPreviewUrl.replace("toolbar=0", "toolbar=1").replace("navpanes=0", "navpanes=1")
    : undefined;

  return (
    <>
      <div className="min-h-0 flex-1 p-4 pt-18 sm:p-6 sm:pt-20">
        <iframe
          src={fullPdfUrl}
          title={file.name}
          className="h-full w-full rounded-[26px] border-0 bg-white"
        />
      </div>

      <div className="border-t border-black/5 bg-white/84 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#202724]">{file.name}</p>
            <p
              className="truncate text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]"
              title={file.contentSource ?? `Page ${pdfPage}`}
            >
              {file.contentSource ?? `Page ${pdfPage}`}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog content: Document / text snippet
// ---------------------------------------------------------------------------

function DocumentDialogContent({
  file,
  query,
}: {
  file: FileDetails;
  query: string;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-18 sm:p-8 sm:pt-20">
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
          Document preview
        </p>
        <HighlightedSnippet
          className="mt-4 text-base leading-8 text-[#505854]"
          text={file.contentSnippet ?? file.semanticSummary ?? file.name}
          query={query}
        />
      </div>

      <div className="border-t border-black/5 bg-white/84 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#202724]">{file.name}</p>
            {file.contentSource ? (
              <p
                className="truncate text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]"
                title={file.contentSource}
              >
                {file.contentSource}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog content: Fallback (icon-only files)
// ---------------------------------------------------------------------------

function FallbackDialogContent({ file }: { file: FileDetails }) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-[#737792]">
        <div className="scale-[2.5]">{iconForKind(file.kind)}</div>
        <p className="max-w-full truncate text-sm font-medium text-[#505854]" title={file.name}>
          {file.name}
        </p>
      </div>

      <div className="border-t border-black/5 bg-white/84 px-4 py-3 backdrop-blur sm:px-6">
        <p className="truncate text-sm font-medium text-[#202724]">{file.name}</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}
