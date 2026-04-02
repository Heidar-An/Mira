import { FILE_TYPE_FILTERS, buttonClass, panelClass, primaryButtonClass } from "../app/constants";
import type { FileDetails, ResultViewMode, SavedResult, SearchResult } from "../app/types";
import { InfoRow, StatusNotice } from "../components/cards";
import {
  ArrowRightIcon,
  BookmarkIcon,
  DocumentIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  SearchIcon,
  SparkleIcon,
  iconForKind,
} from "../components/icons";
import { SelectedFilePreview } from "../components/preview";
import { HighlightedSnippet, PreviewInsightCard, ResultExplorerCard } from "../components/results";
import {
  cx,
  detailStatusLabel,
  formatBytes,
  formatDate,
  kindLabel,
  scoreSummary,
} from "../lib/appHelpers";

export interface ResultsViewProps {
  query: string;
  results: SearchResult[];
  featuredResult: SearchResult | null;
  secondaryResults: SearchResult[];
  listResults: SearchResult[];
  selectedFile: FileDetails | null;
  selectedPreviewUrl: string | null;
  recentSearches: string[];
  resultViewMode: ResultViewMode;
  activeKinds: string[];
  isHydrating: boolean;
  isSearching: boolean;
  savedResultPaths: Set<string>;
  onQuerySelect: (query: string) => void;
  onSetViewMode: (mode: ResultViewMode) => void;
  onToggleKindFilter: (kind: string) => void;
  onClearKindFilters: () => void;
  onSelectResult: (fileId: number) => void;
  onOpenPreview: (fileId: number) => Promise<void>;
  onToggleSavedResult: (
    result: Pick<SavedResult, "path" | "name" | "kind" | "extension" | "modifiedAt">,
  ) => void;
  onOpenFile: (path: string) => Promise<void>;
  onRevealFile: (path: string) => Promise<void>;
  bindSelectedFileNode: (node: HTMLDivElement | null) => void;
  message: string | null;
}

export function ResultsView({
  query,
  results,
  featuredResult,
  secondaryResults,
  listResults,
  selectedFile,
  selectedPreviewUrl,
  recentSearches,
  resultViewMode,
  activeKinds,
  isHydrating,
  isSearching,
  savedResultPaths,
  onQuerySelect,
  onSetViewMode,
  onToggleKindFilter,
  onClearKindFilters,
  onSelectResult,
  onOpenPreview,
  onToggleSavedResult,
  onOpenFile,
  onRevealFile,
  bindSelectedFileNode,
  message,
}: ResultsViewProps) {
  const emptyState = isHydrating
    ? "Loading your workspace..."
    : query.trim().length === 0
      ? "Start with a query like “passport photo” or “tax return 2024”."
      : "No files matched that query yet.";

  return (
    <div className="space-y-6">
      <section className="px-1 pt-2">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[0.82rem] uppercase tracking-[0.22em] text-[#727792]">
              Search query analysis
            </p>
            <h1 className="display-type mt-4 max-w-4xl text-[clamp(2.3rem,5vw,4.1rem)] leading-[0.98] text-[#242b28]">
              {query.trim().length > 0 ? query : "Explore your workspace"}
            </h1>
            <p className="mt-4 flex flex-wrap items-center gap-3 text-[1.05rem] text-[#686f6c]">
              <span className="inline-flex items-center gap-2 text-[#272d2a]">
                <SparkleIcon className="h-5 w-5 text-[#737792]" />
                Hybrid lexical + visual matches
              </span>
              <span className="rounded-full bg-[#eaecf8] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[#5d647f]">
                High confidence
              </span>
              {isSearching ? (
                <span className="rounded-full bg-[#f0f1f4] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[#7b8186]">
                  Searching
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="inline-flex rounded-[18px] border border-black/8 bg-white/80 p-1">
              <button
                className={cx(
                  "rounded-[14px] px-3 py-2 text-sm font-medium transition",
                  resultViewMode === "list" ? "bg-[#737792] text-white" : "text-[#58605c]",
                )}
                onClick={() => onSetViewMode("list")}
              >
                List
              </button>
              <button
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
              <button className={buttonClass} onClick={onClearKindFilters}>
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
            {recentSearches.slice(0, 4).map((recent) => (
              <button
                key={recent}
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
          {message ? <p className="mt-3 text-sm text-[color:var(--danger)]">{message}</p> : null}
        </div>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[1.55fr_0.9fr]">
            <article className={cx(panelClass, "p-7")}>
              {featuredResult ? (
                <div>
                  <button
                    className="w-full text-left"
                    onClick={() => onSelectResult(featuredResult.fileId)}
                  >
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[#747a80]">
                      <span className="rounded-full bg-[#eff0f8] px-3 py-1 text-[0.78rem] font-medium text-[#676e88]">
                        {kindLabel(featuredResult.kind)}
                      </span>
                      <span>{featuredResult.extension.toUpperCase() || "FILE"}</span>
                      <span>
                        {featuredResult.modifiedAt
                          ? formatDate(featuredResult.modifiedAt)
                          : "Unknown date"}
                      </span>
                    </div>

                    <div className="mt-4 flex items-start justify-between gap-5">
                      <h2 className="display-type max-w-3xl text-[2rem] leading-tight text-[#202724]">
                        {featuredResult.name}
                      </h2>
                      <div className="text-right">
                        <p className="display-type text-[3.3rem] leading-none text-[#e1e3ea]">
                          {Math.min(99, Math.max(61, Math.round(featuredResult.score / 4)))}
                        </p>
                        <p className="text-xs uppercase tracking-[0.16em] text-[#7b8186]">
                          Similarity
                        </p>
                      </div>
                    </div>

                    <p className="mt-5 max-w-4xl text-[1.05rem] leading-8 text-[#666d6a]">
                      {featuredResult.snippet ??
                        "This file surfaced through strong filename and metadata evidence. Open it to inspect the full contents."}
                    </p>
                  </button>

                  <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
                    <button
                      className={primaryButtonClass}
                      onClick={() => void onOpenPreview(featuredResult.fileId)}
                    >
                      <ArrowRightIcon />
                      Open preview
                    </button>
                    <span className="rounded-full bg-[#eff0f8] px-3 py-1 text-[0.78rem] font-medium text-[#676e88]">
                      {scoreSummary(featuredResult.scoreBreakdown)}
                    </span>
                    <button
                      className={cx(
                        buttonClass,
                        savedResultPaths.has(featuredResult.path) &&
                          "border-transparent bg-[#eff0f8] text-[#5d647f]",
                      )}
                      onClick={() =>
                        onToggleSavedResult({
                          path: featuredResult.path,
                          name: featuredResult.name,
                          kind: featuredResult.kind,
                          extension: featuredResult.extension,
                          modifiedAt: featuredResult.modifiedAt,
                        })
                      }
                    >
                      <BookmarkIcon />
                      {savedResultPaths.has(featuredResult.path) ? "Saved" : "Save result"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>

            <aside className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
              {secondaryResults.map((result) => (
                <button
                  key={result.fileId}
                  className={cx(panelClass, "p-5 text-left")}
                  onClick={() => onSelectResult(result.fileId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-lg font-semibold text-[#737792]">
                      {Math.min(99, Math.max(48, Math.round(result.score / 4)))}%
                    </p>
                    <span className="text-[#7b8186]">{iconForKind(result.kind)}</span>
                  </div>
                  <p className="display-type mt-5 text-[1.55rem] leading-tight text-[#202724]">
                    {result.name}
                  </p>
                  <p className="mt-4 text-sm leading-6 text-[#666d6a]">
                    {result.snippet ?? result.path}
                  </p>
                  <p className="mt-3 text-xs uppercase tracking-[0.12em] text-[#7b8186]">
                    {scoreSummary(result.scoreBreakdown)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.matchReasons.slice(0, 2).map((reason) => (
                      <span
                        key={`${result.fileId}-${reason}`}
                        className="rounded-full bg-[#f3f1ea] px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-[#686f88]"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </aside>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <article className={cx(panelClass, "p-6")}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {resultViewMode === "grid" ? <GridIcon /> : <ListIcon />}
                  <h3 className="display-type text-[1.6rem] text-[#202724]">Explorer</h3>
                </div>
                <p className="text-sm text-[#727977]">
                  {results.length.toLocaleString()} result{results.length === 1 ? "" : "s"}
                </p>
              </div>

              <div
                className={cx(
                  "mt-5",
                  resultViewMode === "grid" ? "grid gap-4 md:grid-cols-2" : "space-y-3",
                )}
              >
                {(listResults.length > 0 ? listResults : results).map((result) => (
                  <ResultExplorerCard
                    key={result.fileId}
                    result={result}
                    query={query}
                    layout={resultViewMode}
                    onSelectResult={onSelectResult}
                  />
                ))}
              </div>
            </article>

            <aside
              ref={bindSelectedFileNode}
              tabIndex={-1}
              className={cx(panelClass, "p-6 outline-none")}
            >
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
                    query={query}
                    className="h-60 rounded-[24px]"
                  />

                  <div>
                    <p className="display-type text-[1.8rem] leading-tight text-[#202724]">
                      {selectedFile.name}
                    </p>
                    <HighlightedSnippet
                      className="mt-3 text-sm leading-7 text-[#666d6a]"
                      text={
                        selectedFile.contentSnippet ??
                        selectedFile.semanticSummary ??
                        "This file is available in your workspace. Use the actions below to open or reveal it."
                      }
                      query={query}
                    />
                  </div>

                  <PreviewInsightCard file={selectedFile} query={query} />

                  <div className="grid gap-3 text-sm text-[#666d6a]">
                    <InfoRow label="Location" value={selectedFile.path} />
                    <InfoRow label="Root" value={selectedFile.rootPath} />
                    <InfoRow label="Size" value={formatBytes(selectedFile.size)} />
                    <InfoRow
                      label="Modified"
                      value={selectedFile.modifiedAt ? formatDate(selectedFile.modifiedAt) : "Unknown"}
                    />
                    {selectedFile.semanticModality ? (
                      <InfoRow label="Semantic mode" value={selectedFile.semanticModality} />
                    ) : null}
                    {selectedFile.semanticModel ? (
                      <InfoRow label="Semantic model" value={selectedFile.semanticModel} />
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
                      className={primaryButtonClass}
                      onClick={() => void onOpenFile(selectedFile.path)}
                    >
                      Open file
                    </button>
                    <button
                      className={buttonClass}
                      onClick={() => void onRevealFile(selectedFile.path)}
                    >
                      Reveal in Finder
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-[24px] bg-[#faf9f6] p-5 text-sm leading-7 text-[#666d6a]">
                  Select a result to inspect the file, preview extracted text, and launch quick
                  actions.
                </div>
              )}

              {message ? <p className="mt-4 text-sm text-[color:var(--danger)]">{message}</p> : null}
            </aside>
          </section>
        </>
      )}
    </div>
  );
}
