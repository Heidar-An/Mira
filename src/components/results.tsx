import { memo } from "react";
import type { KeyboardEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileDetails, SearchQueryIntent, SearchResult } from "../app/types";
import { ArrowRightIcon, iconForKind } from "./icons";
import {
  buildHighlightSegments,
  cx,
  formatRelativeDate,
  kindLabel,
} from "../lib/appHelpers";

export interface HighlightedSnippetProps {
  text: string;
  query: string;
  className?: string;
}

export function HighlightedSnippet({ text, query, className }: HighlightedSnippetProps) {
  const segments = buildHighlightSegments(text, query);

  return (
    <p className={cx("wrap-anywhere", className)}>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <mark
            key={`${segment.text}-${index}`}
            className="rounded bg-[#f5efb8] px-1 text-[#3a3320]"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

export interface ResultListRowProps {
  result: SearchResult;
  query: string;
  selected: boolean;
  onSelectResult: (fileId: number) => void;
  onOpenFile: (path: string) => Promise<void>;
}

function ResultListRowComponent({
  result,
  query,
  selected,
  onSelectResult,
  onOpenFile,
}: ResultListRowProps) {
  return (
    <button
      type="button"
      className={cx(
        "flex w-full items-start gap-3 rounded-[20px] border p-3.5 text-left transition",
        selected
          ? "border-[#c8cede] bg-[#f5f7fd] shadow-[0_12px_30px_rgba(115,119,146,0.12)]"
          : "border-black/5 bg-white/76 hover:bg-white",
      )}
      onClick={() => onSelectResult(result.fileId)}
      onDoubleClick={() => void onOpenFile(result.path)}
    >
      <div
        className={cx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-[#737792]",
          selected ? "bg-[#e8ebf8]" : "bg-[#eef0f6]",
        )}
      >
        {iconForKind(result.kind)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 flex-1 truncate text-[0.98rem] font-medium text-[#202724]">
            {result.name}
          </p>
          <span className="rounded-full bg-[#f3f1ea] px-2 py-1 text-[0.64rem] uppercase tracking-[0.12em] text-[#6b7177]">
            {kindLabel(result.kind)}
          </span>
        </div>

        <HighlightedSnippet
          className="mt-1.5 line-clamp-2 text-sm leading-6 text-[#666d6a]"
          text={result.snippet ?? result.path}
          query={query}
        />

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] uppercase tracking-[0.12em] text-[#7b8186]">
          <span>{result.modifiedAt ? formatRelativeDate(result.modifiedAt) : "Recently indexed"}</span>
          {result.snippetSource ? <span>{result.snippetSource}</span> : null}
        </div>
      </div>
    </button>
  );
}

export const ResultListRow = memo(ResultListRowComponent, (previous, next) => {
  return (
    previous.result === next.result &&
    previous.query === next.query &&
    previous.selected === next.selected
  );
});

export interface ResultGridCardProps {
  result: SearchResult;
  query: string;
  selected: boolean;
  onSelectResult: (fileId: number) => void;
  onOpenFile: (path: string) => Promise<void>;
  onOpenPreview: (path: string) => Promise<void>;
}

function ResultGridCardComponent({
  result,
  query,
  selected,
  onSelectResult,
  onOpenFile,
  onOpenPreview,
}: ResultGridCardProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectResult(result.fileId);
    }
  }

  return (
    <article
      className={cx(
        "rounded-[22px] border p-3.5 transition",
        selected
          ? "border-[#c8cede] bg-[#f6f8fe] shadow-[0_12px_30px_rgba(115,119,146,0.12)]"
          : "border-black/5 bg-white/76 hover:bg-white",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        className="w-full cursor-pointer text-left outline-none"
        onClick={() => onSelectResult(result.fileId)}
        onDoubleClick={() => void onOpenFile(result.path)}
        onKeyDown={handleKeyDown}
      >
        <ResultGridPreview result={result} query={query} />

        <div className="mt-3 flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#eef0f6] text-[#737792]">
            {iconForKind(result.kind)}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.95rem] font-medium text-[#202724]">{result.name}</p>
            <p className="mt-1 text-[0.7rem] uppercase tracking-[0.12em] text-[#7b8186]">
              {kindLabel(result.kind)} •{" "}
              {result.modifiedAt ? formatRelativeDate(result.modifiedAt) : "Recently indexed"}
            </p>
            {result.snippetSource ? (
              <p className="mt-1 text-[0.68rem] uppercase tracking-[0.12em] text-[#8b9095]">
                {result.snippetSource}
              </p>
            ) : null}
            <HighlightedSnippet
              className="mt-2 line-clamp-3 text-sm leading-6 text-[#666d6a]"
              text={result.snippet ?? result.path}
              query={query}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-2 rounded-[14px] bg-[#737792] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#676b86]"
          onClick={() => void onOpenPreview(result.path)}
        >
          <ArrowRightIcon />
          Open preview
        </button>
      </div>
    </article>
  );
}

export const ResultGridCard = memo(ResultGridCardComponent, (previous, next) => {
  return (
    previous.result === next.result &&
    previous.query === next.query &&
    previous.selected === next.selected
  );
});

function ResultGridPreview({ result, query }: { result: SearchResult; query: string }) {
  const previewUrl = result.previewPath ? convertFileSrc(result.previewPath) : null;

  if (previewUrl && result.kind === "image") {
    return (
      <div className="h-28 overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_top,rgba(228,231,250,0.45),transparent_55%),#eef0f6]">
        <img src={previewUrl} alt={result.name} className="h-full w-full object-cover" />
      </div>
    );
  }

  if (previewUrl && result.extension.toLowerCase() === "pdf") {
    return (
      <div className="relative h-28 overflow-hidden rounded-[18px] bg-[#eef0f6]">
        <iframe
          src={`${previewUrl}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          title={`${result.name} preview`}
          className="pointer-events-none h-[calc(100%+80px)] w-full border-0 bg-white"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#eef0f6] via-[#eef0f6]/92 to-transparent" />
      </div>
    );
  }

  if (result.snippet) {
    return (
      <div className="h-28 rounded-[18px] border border-black/5 bg-[#fbfaf7] p-3">
        <p className="text-[0.64rem] uppercase tracking-[0.14em] text-[#7c8187]">
          {result.snippetSource ? `Content preview • ${result.snippetSource}` : "Content preview"}
        </p>
        <HighlightedSnippet
          className="mt-2 line-clamp-4 text-sm leading-5 text-[#555d59]"
          text={result.snippet}
          query={query}
        />
      </div>
    );
  }

  return (
    <div className="grid h-28 place-items-center rounded-[18px] bg-[#eef0f6] text-[#737792]">
      {iconForKind(result.kind)}
    </div>
  );
}

export interface PreviewInsightCardProps {
  file: FileDetails;
  query: string;
}

export function PreviewInsightCard({ file, query }: PreviewInsightCardProps) {
  return (
    <div className="rounded-[22px] border border-black/5 bg-[#fbfaf7] p-4">
      <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
        Preview focus
      </p>
      <HighlightedSnippet
        className="mt-3 text-sm leading-7 text-[#666d6a]"
        text={
          file.contentSource
            ? `Preview anchored to ${file.contentSource}.`
            : file.extension.toLowerCase() === "pdf"
              ? "Preview starts on the first available PDF page."
              : "Preview follows the strongest extracted snippet for this file."
        }
        query={query}
      />
    </div>
  );
}

export interface ScoreBreakdownCardProps {
  result: SearchResult;
  queryIntent: SearchQueryIntent | null;
}

export function ScoreBreakdownCard({ result, queryIntent }: ScoreBreakdownCardProps) {
  const b = result.scoreBreakdown;
  const total =
    b.metadata +
    b.lexical +
    b.semanticText +
    b.semanticImage +
    b.semanticMedia +
    b.intent +
    b.recency;

  const bars: { label: string; value: number; color: string }[] = [
    { label: "Filename", value: b.metadata, color: "#8b7ec8" },
    { label: "Contents", value: b.lexical, color: "#5a8fbf" },
    { label: "Text match", value: b.semanticText, color: "#4ea87b" },
    { label: "Image match", value: b.semanticImage, color: "#c78b4e" },
    { label: "Media match", value: b.semanticMedia, color: "#5d8ec9" },
    { label: "Intent", value: b.intent, color: "#d06f8d" },
    { label: "Recency", value: b.recency, color: "#9a9aaa" },
  ];

  const maxBar = Math.max(...bars.map((bar) => Math.abs(bar.value)), 1);

  return (
    <div className="rounded-[22px] border border-[#dfe1ec]/60 bg-[#f8f8fc] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
          Score breakdown
        </p>
        <span className="text-lg font-semibold tabular-nums text-[#3a3f5a]">{total}</span>
      </div>

      <div className="mt-3 space-y-2">
        {bars.map((bar) => (
          <div key={bar.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[0.7rem] text-[#6d7470]">{bar.label}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-black/4">
              {bar.value !== 0 && (
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                  style={{
                    width: `${(Math.abs(bar.value) / maxBar) * 100}%`,
                    backgroundColor: bar.color,
                    opacity: 0.7,
                  }}
                />
              )}
            </div>
            <span className="w-8 text-right text-[0.7rem] tabular-nums text-[#6d7470]">
              {bar.value}
            </span>
          </div>
        ))}
      </div>

      {result.semanticScore != null && (
        <p className="mt-3 text-[0.72rem] text-[#6d7470]">
          Similarity:{" "}
          <span className="font-medium text-[#3a3f5a]">{result.semanticScore.toFixed(4)}</span>
        </p>
      )}
      {queryIntent && (
        <p className="mt-1 text-[0.72rem] text-[#6d7470]">
          Intent classifier:{" "}
          <span className="font-medium text-[#3a3f5a]">{formatQueryIntent(queryIntent)}</span>
        </p>
      )}
      {result.matchReasons.length > 0 && (
        <p className="mt-1 text-[0.72rem] text-[#6d7470]">
          Matched by: <span className="text-[#3a3f5a]">{result.matchReasons.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

function formatQueryIntent(queryIntent: SearchQueryIntent) {
  if (
    queryIntent.status === "success" &&
    queryIntent.kind &&
    queryIntent.confidence != null
  ) {
    const modelNote = queryIntent.model ? ` via ${queryIntent.model}` : "";
    return `Detected ${kindLabel(queryIntent.kind)} (${queryIntent.confidence}%)${modelNote}`;
  }

  if (queryIntent.message) {
    if (queryIntent.model) {
      return `${queryIntent.message} [model: ${queryIntent.model}]`;
    }
    return queryIntent.message;
  }

  switch (queryIntent.status) {
    case "waiting":
      return "Waiting for full search.";
    case "too_short":
      return "Type at least 3 characters or 2 words.";
    case "missing_key":
      return "Intent classifier unavailable without a Gemini key.";
    case "error":
      return "Classification failed.";
    default:
      return "Not available.";
  }
}
