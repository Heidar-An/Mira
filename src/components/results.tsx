import type { FileDetails, ResultViewMode, SearchResult } from "../app/types";
import { iconForKind } from "./icons";
import {
  buildHighlightSegments,
  cx,
  formatRelativeDate,
  kindLabel,
  scoreSummary,
} from "../lib/appHelpers";

export interface HighlightedSnippetProps {
  text: string;
  query: string;
  className?: string;
}

export function HighlightedSnippet({
  text,
  query,
  className,
}: HighlightedSnippetProps) {
  const segments = buildHighlightSegments(text, query);

  return (
    <p className={className}>
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

export interface ResultExplorerCardProps {
  result: SearchResult;
  query: string;
  layout: ResultViewMode;
  onSelectResult: (fileId: number) => void;
}

export function ResultExplorerCard({
  result,
  query,
  layout,
  onSelectResult,
}: ResultExplorerCardProps) {
  const cardClass =
    layout === "grid"
      ? "rounded-[24px] border border-black/5 bg-white/72 p-5 text-left transition hover:-translate-y-0.5 hover:bg-white"
      : "flex w-full items-start gap-4 rounded-[22px] border border-black/5 bg-white/70 p-4 text-left transition hover:-translate-y-0.5 hover:bg-white";

  return (
    <button className={cardClass} onClick={() => onSelectResult(result.fileId)}>
      <div
        className={cx(
          "grid shrink-0 place-items-center rounded-2xl bg-[#eef0f6] text-[#737792]",
          layout === "grid" ? "h-14 w-14" : "h-12 w-12",
        )}
      >
        {iconForKind(result.kind)}
      </div>
      <div className={cx("min-w-0", layout === "grid" ? "mt-4" : "flex-1")}>
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7b8186]">
          {kindLabel(result.kind)} •{" "}
          {result.modifiedAt ? formatRelativeDate(result.modifiedAt) : "Recently indexed"}
        </p>
        <p className="display-type mt-2 text-[1.3rem] leading-8 text-[#202724]">
          {result.name}
        </p>
        <HighlightedSnippet
          className="mt-2 text-sm leading-6 text-[#666d6a]"
          text={result.snippet ?? result.path}
          query={query}
        />
        <p className="mt-3 text-xs uppercase tracking-[0.12em] text-[#7b8186]">
          {scoreSummary(result.scoreBreakdown)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {result.matchReasons.slice(0, 3).map((reason) => (
            <span
              key={`${result.fileId}-${reason}`}
              className="rounded-full bg-[#f3f1ea] px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-[#686f88]"
            >
              {reason}
            </span>
          ))}
        </div>
      </div>
    </button>
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
