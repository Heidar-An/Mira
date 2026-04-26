import { useRef } from "react";
import type { RefObject } from "react";
import { FILE_TYPE_FILTERS, buttonClass, panelClass, primaryButtonClass } from "../app/constants";
import type {
  FileDetails,
  ResultViewMode,
  SavedResult,
  SearchQueryIntent,
  SearchResult,
} from "../app/types";
import { InfoRow, StatusNotice } from "../components/cards";
import {
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  SearchIcon,
  SparkleIcon,
} from "../components/icons";
import { SelectedFilePreview } from "../components/preview";
import {
  HighlightedSnippet,
  PreviewInsightCard,
  ResultGridCard,
  ResultListRow,
  ScoreBreakdownCard,
} from "../components/results";
import {
  cx,
  detailStatusLabel,
  formatBytes,
  formatDate,
  kindLabel,
} from "../lib/appHelpers";

export interface ResultsViewProps {
  query: string;
  resultsQuery: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  totalResultCount: number;
  currentPage: number;
  hasMore: boolean;
  resultsQueryIntent: SearchQueryIntent | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onGoToPage: (page: number) => Promise<void>;
  selectedFile: FileDetails | null;
  selectedPreviewUrl: string | null;
  recentSearches: string[];
  onClearRecentSearches: () => void;
  resultViewMode: ResultViewMode;
  activeKinds: string[];
  isHydrating: boolean;
  isSearching: boolean;
  isRefiningSearch: boolean;
  savedResultPaths: Set<string>;
  onQuerySelect: (query: string) => void;
  onSetViewMode: (mode: ResultViewMode) => void;
  onToggleKindFilter: (kind: string) => void;
  onClearKindFilters: () => void;
  onSelectResult: (fileId: number) => void;
  onToggleSavedResult: (
    result: Pick<SavedResult, "path" | "name" | "kind" | "extension" | "modifiedAt">,
  ) => void;
  onOpenFile: (path: string) => Promise<void>;
  onRevealFile: (path: string) => Promise<void>;
  showScoreBreakdown: boolean;
  message: string | null;
}

export function ResultsView({
  query,
  resultsQuery,
  setQuery,
  results,
  totalResultCount,
  currentPage,
  hasMore,
  resultsQueryIntent,
  scrollContainerRef,
  onGoToPage,
  selectedFile,
  selectedPreviewUrl,
  recentSearches,
  onClearRecentSearches,
  resultViewMode,
  activeKinds,
  isHydrating,
  isSearching,
  isRefiningSearch,
  savedResultPaths,
  onQuerySelect,
  onSetViewMode,
  onToggleKindFilter,
  onClearKindFilters,
  onSelectResult,
  onToggleSavedResult,
  onOpenFile,
  onRevealFile,
  showScoreBreakdown,
  message,
}: ResultsViewProps) {
  const topAnchorRef = useRef<HTMLDivElement | null>(null);

  const emptyState = isHydrating
    ? "Loading your workspace..."
    : query.trim().length === 0
      ? "Start with a query like “passport photo” or “tax return 2024”."
      : "No files matched that query yet.";
  const selectedFileSaved = selectedFile ? savedResultPaths.has(selectedFile.path) : false;

  async function handleGoToPage(page: number) {
    if (page === currentPage) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }

    await smoothScrollToTop(scrollContainerRef.current);
    await onGoToPage(page);
    await waitForNextPaint();
    topAnchorRef.current?.focus({ preventScroll: true });
    forceScrollToTop(scrollContainerRef.current);
  }

  return (
    <div className="space-y-6">
      <div ref={topAnchorRef} tabIndex={-1} className="outline-none" />
      <section className="px-1 pt-2">
        <div className="mx-auto mb-6 max-w-5xl rounded-[28px] border border-black/5 bg-white/78 p-3 shadow-[0_22px_60px_rgba(85,93,122,0.08)]">
          <div className="flex items-center gap-4 rounded-[22px] bg-[#fcfbf8] px-5 py-4">
            <SparkleIcon className="h-6 w-6 shrink-0 text-[#737792]" />
            <input
              className="w-full bg-transparent text-[1.15rem] text-[#222825] outline-none placeholder:text-[#9da2a6]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Search your workspace..."
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3 text-[1.05rem] text-[#686f6c]">
              <span className="inline-flex items-center gap-2 text-[#272d2a]">
                <SparkleIcon className="h-5 w-5 text-[#737792]" />
                Search results
              </span>
              <span className="rounded-full bg-[#eaecf8] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[#5d647f]">
                {totalResultCount.toLocaleString()}{hasMore ? "+" : ""} result{totalResultCount === 1 && !hasMore ? "" : "s"}
              </span>
              {isSearching ? (
                <span className="rounded-full bg-[#f0f1f4] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[#7b8186]">
                  Searching
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="inline-flex rounded-[18px] border border-black/8 bg-white/80 p-1">
              <button
                type="button"
                className={cx(
                  "rounded-[14px] px-3 py-2 text-sm font-medium transition",
                  resultViewMode === "list" ? "bg-[#737792] text-white" : "text-[#58605c]",
                )}
                onClick={() => onSetViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={cx(
                  "rounded-[14px] px-3 py-2 text-sm font-medium transition",
                  resultViewMode === "grid" ? "bg-[#737792] text-white" : "text-[#58605c]",
                )}
                onClick={() => onSetViewMode("grid")}
              >
                Grid
              </button>
            </div>
            {activeKinds.length > 0 ? (
              <button type="button" className={buttonClass} onClick={onClearKindFilters}>
                <FilterIcon />
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {FILE_TYPE_FILTERS.map((kind) => {
            const active = activeKinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                className={cx(
                  "rounded-full px-4 py-2 text-sm font-medium transition",
                  active
                    ? "bg-[#737792] text-white shadow-[0_10px_24px_rgba(115,119,146,0.18)]"
                    : "bg-[#f3f1ea] text-[#646b67] hover:bg-[#ebe7de]",
                )}
                onClick={() => onToggleKindFilter(kind)}
              >
                {kindLabel(kind)}
              </button>
            );
          })}
        </div>

        {recentSearches.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[#6c7370]">
            <span className="uppercase tracking-[0.16em] text-[0.72rem] text-[#848a8e]">
              Recent
            </span>
            <button
              type="button"
              className="rounded-full border border-black/5 bg-white px-3 py-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-[#6f7571] transition hover:bg-[#f8f6f1]"
              onClick={onClearRecentSearches}
            >
              Clear
            </button>
            {recentSearches.slice(0, 4).map((recent) => (
              <button
                key={recent}
                type="button"
                className="rounded-full border border-black/5 bg-white px-3 py-1.5 text-[#4f5652] transition hover:bg-[#f8f6f1]"
                onClick={() => onQuerySelect(recent)}
              >
                {recent}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {results.length === 0 ? (
        <div className={cx(panelClass, "p-8 text-center")}>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef0f6] text-[#737792]">
            {isSearching || isHydrating ? <SearchIcon className="h-6 w-6" /> : <DocumentIcon />}
          </div>
          <p className="display-type mt-5 text-[2rem] text-[#262d2a]">{emptyState}</p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-[#6d7470]">
            {activeKinds.length > 0
              ? "Try removing a type filter or switching back to all results."
              : "You can search by filename, text contents, semantic meaning, and visual similarity."}
          </p>
          {isRefiningSearch ? <SemanticRefinementBar className="mx-auto mt-6 max-w-2xl" /> : null}
          {message ? <p className="mt-3 text-sm text-[color:var(--danger)]">{message}</p> : null}
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.85fr)]">
          <article className={cx(panelClass, "min-h-0 p-5 pb-3 sm:p-6 sm:pb-4")}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {resultViewMode === "grid" ? <GridIcon /> : <ListIcon />}
                <div>
                  <h2 className="display-type text-[1.55rem] text-[#202724]">Results</h2>
                  <p className="text-sm text-[#727977]">
                    {resultViewMode === "grid"
                      ? "Compact cards with inline previews."
                      : "Filename-first rows with preview details on the right."}
                  </p>
                </div>
              </div>
              <p className="text-sm text-[#727977]">
                Page {currentPage}
              </p>
            </div>

            <div
              className={cx(
                "mt-5",
                resultViewMode === "grid"
                  ? "grid gap-3 sm:grid-cols-2 2xl:grid-cols-3"
                  : "space-y-2.5",
              )}
            >
              {results.map((result) =>
                resultViewMode === "grid" ? (
                  <ResultGridCard
                    key={result.fileId}
                    result={result}
                    query={resultsQuery}
                    selected={selectedFile?.fileId === result.fileId}
                    onSelectResult={onSelectResult}
                    onOpenFile={onOpenFile}
                    onOpenPreview={onOpenFile}
                  />
                ) : (
                  <ResultListRow
                    key={result.fileId}
                    result={result}
                    query={resultsQuery}
                    selected={selectedFile?.fileId === result.fileId}
                    onSelectResult={onSelectResult}
                    onOpenFile={onOpenFile}
                  />
                ),
              )}
            </div>

            {(currentPage > 1 || hasMore) && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  className={cx(
                    "grid h-10 w-10 place-items-center rounded-full border border-black/8 transition",
                    currentPage <= 1
                      ? "cursor-not-allowed text-[#c4c8cb]"
                      : "bg-white/80 text-[#58605c] hover:-translate-y-0.5 hover:bg-white",
                  )}
                  onClick={() => void handleGoToPage(currentPage - 1)}
                >
                  <ChevronLeftIcon />
                </button>
                <span className="rounded-full bg-[#eff0f8] px-4 py-2 text-sm font-medium text-[#676e88]">
                  Page {currentPage}
                </span>

                <button
                  type="button"
                  disabled={!hasMore}
                  className={cx(
                    "grid h-10 w-10 place-items-center rounded-full border border-black/8 transition",
                    !hasMore
                      ? "cursor-not-allowed text-[#c4c8cb]"
                      : "bg-white/80 text-[#58605c] hover:-translate-y-0.5 hover:bg-white",
                  )}
                  onClick={() => void handleGoToPage(currentPage + 1)}
                >
                  <ChevronRightIcon />
                </button>
              </div>
            )}

            {isRefiningSearch ? <SemanticRefinementBar className="sticky bottom-3 z-10 mt-5" /> : null}
          </article>

          <aside className={cx(panelClass, "p-6")}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="display-type text-[1.6rem] text-[#202724]">Selected file</h3>
              {selectedFile ? (
                <span className="rounded-full bg-[#eff0f8] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[#676e88]">
                  {detailStatusLabel(selectedFile)}
                </span>
              ) : null}
            </div>

            {selectedFile ? (
              <div className="mt-5 space-y-5">
                <SelectedFilePreview
                  file={selectedFile}
                  previewUrl={selectedPreviewUrl}
                  query={resultsQuery}
                  className="h-60 rounded-[24px]"
                />

                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="display-type wrap-anywhere line-clamp-2 text-[1.8rem] leading-tight text-[#202724]"
                        title={selectedFile.name}
                      >
                        {selectedFile.name}
                      </p>
                      <p className="mt-2 text-[0.72rem] uppercase tracking-[0.14em] text-[#7b8186]">
                        {kindLabel(selectedFile.kind)} •{" "}
                        {selectedFile.modifiedAt
                          ? formatDate(selectedFile.modifiedAt)
                          : "Unknown date"}
                      </p>
                    </div>

                    <button
                      type="button"
                      className={cx(
                        buttonClass,
                        selectedFileSaved && "border-transparent bg-[#eff0f8] text-[#5d647f]",
                      )}
                      onClick={() =>
                        onToggleSavedResult({
                          path: selectedFile.path,
                          name: selectedFile.name,
                          kind: selectedFile.kind,
                          extension: selectedFile.extension,
                          modifiedAt: selectedFile.modifiedAt,
                        })
                      }
                    >
                      <BookmarkIcon />
                      {selectedFileSaved ? "Saved" : "Save result"}
                    </button>
                  </div>

                  <HighlightedSnippet
                    className="mt-3 line-clamp-6 text-sm leading-7 text-[#666d6a]"
                    text={
                      selectedFile.contentSnippet ??
                      selectedFile.semanticSummary ??
                      "This file is available in your workspace. Use the actions below to open or reveal it."
                    }
                    query={resultsQuery}
                  />
                </div>

                <PreviewInsightCard file={selectedFile} query={resultsQuery} />

                {showScoreBreakdown
                  ? (() => {
                      const matchingResult = results.find((r) => r.fileId === selectedFile.fileId);
                      return matchingResult ? (
                        <ScoreBreakdownCard
                          result={matchingResult}
                          queryIntent={resultsQueryIntent}
                        />
                      ) : null;
                    })()
                  : null}

                <div className="grid gap-3 text-sm text-[#666d6a]">
                  <InfoRow label="Location" value={selectedFile.path} />
                  <InfoRow label="Root" value={selectedFile.rootPath} />
                  <InfoRow label="Size" value={formatBytes(selectedFile.size)} />
                  <InfoRow
                    label="Modified"
                    value={selectedFile.modifiedAt ? formatDate(selectedFile.modifiedAt) : "Unknown"}
                  />
                  {selectedFile.semanticModality ? (
                    <InfoRow
                      label="Match type"
                      value={
                        selectedFile.semanticModality === "image"
                          ? "Image matching"
                          : "Text matching"
                      }
                    />
                  ) : null}
                  {selectedFile.contentSource ? (
                    <InfoRow label="Snippet source" value={selectedFile.contentSource} />
                  ) : null}
                  <InfoRow label="Indexed" value={formatDate(selectedFile.indexedAt)} />
                </div>

                {selectedFile.extractionError ? (
                  <StatusNotice
                    tone="danger"
                    title="Content extraction needs attention"
                    body={selectedFile.extractionError}
                  />
                ) : null}
                {selectedFile.semanticError ? (
                  <StatusNotice
                    tone="warning"
                    title="Semantic enrichment is partial"
                    body={selectedFile.semanticError}
                  />
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    onClick={() => void onOpenFile(selectedFile.path)}
                  >
                    Open file
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void onRevealFile(selectedFile.path)}
                  >
                    Reveal in Finder
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] bg-[#faf9f6] p-5 text-sm leading-7 text-[#666d6a]">
                Select a result to inspect the file, preview extracted text, and review metadata.
              </div>
            )}

            {message ? <p className="mt-4 text-sm text-[color:var(--danger)]">{message}</p> : null}
          </aside>
        </section>
      )}
    </div>
  );
}

function SemanticRefinementBar({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-3 rounded-[18px] border border-[#d7dcee] bg-[#f6f7ff]/95 px-4 py-3 text-left shadow-[0_14px_34px_rgba(82,88,124,0.16)] backdrop-blur",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e5e9fb]">
          <span className="absolute h-4 w-4 animate-ping rounded-full bg-[#737792]/25" />
          <span className="h-2 w-2 rounded-full bg-[#737792]" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#2e3544]">Smart matches still loading</p>
          <p className="mt-0.5 text-xs leading-5 text-[#68708a]">
            These are fast results; semantic and visual matches may reorder or add files.
          </p>
        </div>
      </div>
      <span className="hidden shrink-0 rounded-full bg-white/80 px-3 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-[#646b86] sm:inline-flex">
        Refining
      </span>
    </div>
  );
}

function smoothScrollToTop(container: HTMLElement | null): Promise<void> {
  if (!container || container.scrollTop <= 0) {
    return Promise.resolve();
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    container.scrollTop = 0;
    return Promise.resolve();
  }

  const start = container.scrollTop;
  const durationMs = 240;

  return new Promise((resolve) => {
    const startedAt = performance.now();

    const step = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      container.scrollTop = start * (1 - eased);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        container.scrollTop = 0;
        resolve();
      }
    };

    window.requestAnimationFrame(step);
  });
}

function forceScrollToTop(container: HTMLElement | null) {
  if (!container) {
    return;
  }

  container.scrollTop = 0;
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}
