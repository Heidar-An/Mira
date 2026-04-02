import { panelClass } from "../app/constants";
import type { IndexedRoot } from "../app/types";
import { OverviewCard } from "../components/cards";
import { cx } from "../lib/appHelpers";

export interface SettingsViewProps {
  headerTitle: string;
  totalFiles: number;
  roots: IndexedRoot[];
  currentStatusText: string;
}

export function SettingsView({
  headerTitle,
  totalFiles,
  roots,
  currentStatusText,
}: SettingsViewProps) {
  return (
    <div className="space-y-6">
      <section className="px-1 pt-2">
        <p className="text-[0.82rem] uppercase tracking-[0.22em] text-[#727792]">
          {headerTitle}
        </p>
        <h1 className="display-type mt-4 text-[clamp(2.5rem,5vw,3.8rem)] leading-[0.96] text-[#242b28]">
          Tune the workspace behavior
        </h1>
        <p className="mt-4 max-w-3xl text-[1.08rem] leading-8 text-[#6a716d]">
          These settings are placeholders for the next product layer, but the cards already
          reflect the live state of your local workspace.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <OverviewCard
          label="Workspace status"
          value={currentStatusText}
          meta="Live state from the local index"
        />
        <OverviewCard
          label="Indexed files"
          value={totalFiles.toLocaleString()}
          meta="Searchable metadata and extracted text"
        />
        <OverviewCard
          label="Connected sources"
          value={roots.length.toLocaleString()}
          meta="Local folders in your workspace"
        />
      </section>

      <section className={cx(panelClass, "p-6")}>
        <h2 className="display-type text-[1.8rem] text-[#202724]">What comes next</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            "Saved search collections and pinned files",
            "Drag-and-drop result actions for triage flows",
            "Deeper preview support for Office documents",
            "Smarter recovery tools for failed semantic batches",
          ].map((item) => (
            <div key={item} className="rounded-[24px] bg-[#faf9f6] p-5 text-sm leading-7 text-[#6d7470]">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
