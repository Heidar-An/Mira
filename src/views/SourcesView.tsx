import { buttonClass, panelClass, primaryButtonClass } from "../app/constants";
import type { IndexStatus, IndexedRoot } from "../app/types";
import { MetricPanel, PassProgressRow } from "../components/cards";
import { FolderIcon, RefreshIcon } from "../components/icons";
import {
  cx,
  formatCompact,
  formatDate,
  formatPassValue,
  formatRelativeDate,
  freshnessLabel,
  rootPipelineLabel,
  shortPath,
  stagePercent,
  statusLabel,
  statusPillClass,
  syncStatusLabel,
} from "../lib/appHelpers";

export interface SourcesViewProps {
  roots: IndexedRoot[];
  statuses: Record<number, IndexStatus>;
  totalFiles: number;
  totalContentIndexed: number;
  totalContentPending: number;
  totalSemanticIndexed: number;
  totalSemanticPending: number;
  runningIndexCount: number;
  selectedRootIds: number[];
  toggleRoot: (rootId: number) => void;
  onAddFolder: () => Promise<void>;
  onRescan: (rootId: number) => Promise<void>;
  onRescanAll: () => Promise<void>;
  onRemoveRoot: (rootId: number) => Promise<void>;
}

export function SourcesView({
  roots,
  statuses,
  totalFiles,
  totalContentIndexed,
  totalContentPending,
  totalSemanticIndexed,
  totalSemanticPending,
  runningIndexCount,
  selectedRootIds,
  toggleRoot,
  onAddFolder,
  onRescan,
  onRescanAll,
  onRemoveRoot,
}: SourcesViewProps) {
  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 px-1 pt-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[0.82rem] uppercase tracking-[0.22em] text-[#727792]">
            Source management
          </p>
          <h1 className="display-type mt-4 text-[clamp(2.5rem,5vw,3.8rem)] leading-[0.96] text-[#242b28]">
            Sources & indexing
          </h1>
          <p className="mt-4 max-w-3xl text-[1.08rem] leading-8 text-[#6a716d]">
            Manage local folders, monitor indexing progress, and keep your workspace ready for
            natural-language search.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={buttonClass} onClick={() => void onRescanAll()}>
            Re-index all
          </button>
          <button className={primaryButtonClass} onClick={() => void onAddFolder()}>
            Connect source
          </button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <MetricPanel
          title="Metadata indexed"
          value={formatCompact(totalFiles)}
          note={`${roots.length} sources connected`}
          bar={100}
        />
        <MetricPanel
          title="Content extracted"
          value={formatPassValue(totalContentIndexed, totalContentIndexed + totalContentPending)}
          note={
            totalContentPending > 0
              ? `${totalContentPending.toLocaleString()} files still waiting for text extraction`
              : "All supported files are content-searchable"
          }
          segmented
        />
        <MetricPanel
          title="Semantic enriched"
          value={formatPassValue(totalSemanticIndexed, totalSemanticIndexed + totalSemanticPending)}
          note={
            runningIndexCount > 0
              ? "Fast metadata pass is still running"
              : totalSemanticPending > 0
                ? `${totalSemanticPending.toLocaleString()} files still waiting for semantic enrichment`
                : "Semantic enrichment is up to date"
          }
          indicator
        />
      </section>

      <section className={cx(panelClass, "p-6")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="display-type text-[1.8rem] text-[#202724]">Active sources</h2>
          <div className="text-sm text-[#727977]">
            {selectedRootIds.length > 0
              ? `${selectedRootIds.length} source filter${selectedRootIds.length === 1 ? "" : "s"} active`
              : "Showing all connected sources"}
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {roots.length > 0 ? (
            roots.map((root) => {
              const status = statuses[root.id];
              const metadataProgress =
                status && status.total > 0
                  ? Math.round((status.processed / status.total) * 100)
                  : root.status === "ready"
                    ? 100
                    : 0;
              const contentTotal = root.contentIndexedCount + root.contentPendingCount;
              const semanticTotal = root.semanticIndexedCount + root.semanticPendingCount;

              return (
                <article
                  key={root.id}
                  className={cx(
                    "grid gap-4 rounded-[24px] border border-black/5 bg-white/72 p-5 transition lg:grid-cols-[auto_minmax(0,1fr)_auto]",
                    selectedRootIds.includes(root.id) && "ring-2 ring-[#7377921f]",
                  )}
                >
                  <button
                    className="grid h-16 w-16 place-items-center rounded-[22px] bg-[#eceef6] text-[#737792]"
                    onClick={() => toggleRoot(root.id)}
                  >
                    <FolderIcon />
                  </button>

                  <div className="min-w-0">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p
                          className="display-type wrap-anywhere line-clamp-2 text-[1.45rem] leading-8 text-[#202724]"
                          title={root.path}
                        >
                          {shortPath(root.path)}
                        </p>
                        <p className="wrap-anywhere mt-1 text-sm leading-6 text-[#6d7470]">
                          {root.path}
                        </p>
                      </div>
                      <span className={statusPillClass(root.status)}>{statusLabel(root.status)}</span>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-3 text-sm text-[#70767a]">
                        <span>Pipeline progress</span>
                        <span>{rootPipelineLabel(root, status)}</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        <PassProgressRow
                          label="Metadata"
                          value={`${status && status.status === "running" ? metadataProgress : root.fileCount > 0 ? 100 : 0}%`}
                          progress={
                            status && status.status === "running"
                              ? metadataProgress
                              : root.fileCount > 0
                                ? 100
                                : 0
                          }
                          tone="primary"
                        />
                        <PassProgressRow
                          label="Content"
                          value={formatPassValue(root.contentIndexedCount, contentTotal)}
                          progress={stagePercent(root.contentIndexedCount, contentTotal)}
                          tone="secondary"
                        />
                        <PassProgressRow
                          label="Semantic"
                          value={formatPassValue(root.semanticIndexedCount, semanticTotal)}
                          progress={stagePercent(root.semanticIndexedCount, semanticTotal)}
                          tone="muted"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-4 text-sm text-[#6d7470]">
                      <span>{root.fileCount.toLocaleString()} files</span>
                      <span>{root.contentIndexedCount.toLocaleString()} content-ready</span>
                      <span>{root.semanticIndexedCount.toLocaleString()} semantic-ready</span>
                      <span>{syncStatusLabel(root.syncStatus)}</span>
                      <span>{freshnessLabel(root)}</span>
                      <span>{root.lastIndexedAt ? formatDate(root.lastIndexedAt) : "Not indexed yet"}</span>
                      <span>
                        {root.lastSyncedAt
                          ? `Synced ${formatRelativeDate(root.lastSyncedAt)}`
                          : "Sync not started"}
                      </span>
                      {status?.currentPath ? (
                        <span className="min-w-0 basis-full truncate" title={status.currentPath}>
                          {status.currentPath}
                        </span>
                      ) : null}
                    </div>

                    {root.lastError ? (
                      <p className="mt-3 text-sm text-[color:var(--danger)]">{root.lastError}</p>
                    ) : null}
                  </div>

                  <div className="flex items-start gap-2 lg:flex-col">
                    <button className={buttonClass} onClick={() => void onRescan(root.id)}>
                      <RefreshIcon />
                      Rescan
                    </button>
                    <button
                      className={cx(buttonClass, "text-[color:var(--danger)]")}
                      onClick={() => void onRemoveRoot(root.id)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-[24px] bg-[#faf9f6] p-8 text-center text-[#6d7470]">
              <p className="display-type text-[1.8rem] text-[#202724]">No sources connected yet.</p>
              <p className="mt-3 text-base leading-7">
                Add a local folder to start building your workspace index.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
