import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logoSrc from "../assets/logo.png";
import { buttonClass, panelClass, primaryButtonClass } from "./constants";
import { useAppController } from "./useAppController";
import type { ViewName } from "./types";
import { SidebarLink } from "../components/navigation";
import {
  DatabaseIcon,
  HomeIcon,
  PlusIcon,
  ResultsIcon,
  SettingsIcon,
  UserIcon,
} from "../components/icons";
import { HomeView } from "../views/HomeView";
import { ResultsView } from "../views/ResultsView";
import { SettingsView } from "../views/SettingsView";
import { SourcesView } from "../views/SourcesView";
import { cx } from "../lib/appHelpers";

type PendingSettingsExit =
  | { type: "view"; view: ViewName }
  | { type: "addFolder" }
  | { type: "close" };

export function App() {
  const { state, derived, actions, refs } = useAppController();
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const closeBypassRef = useRef(false);
  const settingsHasChangesRef = useRef(derived.settingsHasChanges);
  const [pendingSettingsExit, setPendingSettingsExit] = useState<PendingSettingsExit | null>(null);

  useEffect(() => {
    settingsHasChangesRef.current = derived.settingsHasChanges;
  }, [derived.settingsHasChanges]);

  useEffect(() => {
    const tauriWindow = window as typeof window & { __TAURI_INTERNALS__?: unknown };
    if (!tauriWindow.__TAURI_INTERNALS__) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (closeBypassRef.current || !settingsHasChangesRef.current) {
          return;
        }

        event.preventDefault();
        setPendingSettingsExit({ type: "close" });
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  function requestViewChange(view: ViewName) {
    if (
      state.currentView === "settings" &&
      view !== "settings" &&
      derived.settingsHasChanges
    ) {
      setPendingSettingsExit({ type: "view", view });
      return;
    }

    actions.setCurrentView(view);
  }

  function requestAddFolder() {
    if (state.currentView === "settings" && derived.settingsHasChanges) {
      setPendingSettingsExit({ type: "addFolder" });
      return;
    }

    void actions.handleAddFolder();
  }

  async function completePendingExit(exit: PendingSettingsExit) {
    if (exit.type === "view") {
      actions.setCurrentView(exit.view);
      return;
    }

    if (exit.type === "addFolder") {
      await actions.handleAddFolder();
      return;
    }

    closeBypassRef.current = true;
    try {
      await getCurrentWindow().close();
    } finally {
      closeBypassRef.current = false;
    }
  }

  async function handleSaveAndExit() {
    const exit = pendingSettingsExit;
    if (!exit) {
      return;
    }

    const saved = await actions.saveDraftSettings();
    if (!saved) {
      return;
    }

    setPendingSettingsExit(null);
    await completePendingExit(exit);
  }

  async function handleDiscardAndExit() {
    const exit = pendingSettingsExit;
    if (!exit) {
      return;
    }

    actions.discardDraftSettings();
    setPendingSettingsExit(null);
    await completePendingExit(exit);
  }

  return (
    <div className="min-h-dvh p-4 md:p-6">
      <div className="grid min-h-[calc(100dvh-2rem)] grid-cols-1 gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <aside className={cx(panelClass, "flex flex-col overflow-hidden p-5")}>
          <div className="flex items-start gap-4">
            <img src={logoSrc} alt="Mira" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />
            <div>
              <p className="display-type text-[1.1rem] leading-6 text-[#1d2320]">Mira</p>
              <p className="mt-1 text-sm uppercase tracking-[0.16em] text-[#80858a]">
                AI-powered search
              </p>
            </div>
          </div>

          <button className={cx(primaryButtonClass, "mt-8 w-full")} onClick={requestAddFolder}>
            <PlusIcon />
            Add source
          </button>

          <nav className="mt-8 space-y-2">
            <SidebarLink
              label="Home"
              active={state.currentView === "home"}
              onClick={() => requestViewChange("home")}
              icon={<HomeIcon />}
            />
            <SidebarLink
              label="Results"
              active={state.currentView === "results"}
              onClick={() => requestViewChange("results")}
              icon={<ResultsIcon />}
              badge={derived.visibleResults.length > 0 ? derived.visibleResults.length : undefined}
            />
            <SidebarLink
              label="Sources"
              active={state.currentView === "sources"}
              onClick={() => requestViewChange("sources")}
              icon={<DatabaseIcon />}
              badge={state.roots.length > 0 ? state.roots.length : undefined}
            />
            <SidebarLink
              label="Settings"
              active={state.currentView === "settings"}
              onClick={() => requestViewChange("settings")}
              icon={<SettingsIcon />}
            />
          </nav>

          <div className="mt-8 rounded-[24px] bg-[#f4f1ec] p-4">
            <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">
              Current status
            </p>
            <p className="display-type mt-2 text-[1.35rem] leading-8 text-[#222825]">
              {derived.currentStatusText}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#68716d]">
              {derived.runningIndexCount > 0
                ? "Mira is scanning your folders in the background."
                : derived.totalContentPending > 0 || derived.totalSemanticPending > 0
                  ? "Basic search is ready while file contents and image search finish preparing."
                  : "Your workspace is ready for fast search across names, contents, and images."}
            </p>
          </div>

          <div className="mt-auto rounded-[24px] border border-black/5 bg-white/72 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef0f8] text-[#737792]">
                <UserIcon />
              </div>
              <div>
                <p className="font-medium text-[#1d2320]">Mira</p>
                <p className="text-sm text-[#7b8280]">
                  {state.roots.filter((root) => root.status === "ready").length} active source
                  {state.roots.filter((root) => root.status === "ready").length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className={cx(panelClass, "overflow-hidden")}>
          <div className="flex h-full flex-col">
            <div
              ref={mainScrollRef}
              className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-7 sm:py-7"
            >
              {state.currentView === "home" && (
                <HomeView
                  roots={state.roots}
                  totalFiles={derived.totalFiles}
                  totalContentIndexed={derived.totalContentIndexed}
                  totalSemanticIndexed={derived.totalSemanticIndexed}
                  totalSemanticPending={derived.totalSemanticPending}
                  runningIndexCount={derived.runningIndexCount}
                  query={state.query}
                  setQuery={actions.setQuery}
                  setCurrentView={requestViewChange}
                  recentSearches={state.recentSearches}
                  onClearRecentSearches={actions.clearRecentSearches}
                  savedResults={state.savedResults}
                  selectedFile={state.selectedFile}
                  selectedPreviewUrl={derived.selectedPreviewUrl}
                  pinnedRoots={derived.pinnedRoots}
                  bindPreviewNode={refs.bindHomePreviewNode}
                  onShowSavedResult={actions.handleShowSavedResult}
                  onRemoveSavedResult={actions.removeSavedResult}
                  message={state.message}
                />
              )}

              {state.currentView === "results" && (
                <ResultsView
                  query={state.query}
                  resultsQuery={derived.resultsQuery}
                  setQuery={actions.setQuery}
                  results={derived.visibleResults}
                  totalResultCount={derived.visibleResults.length}
                  currentPage={derived.currentPage}
                  hasMore={derived.hasMore}
                  resultsQueryIntent={derived.resultsQueryIntent}
                  scrollContainerRef={mainScrollRef}
                  onGoToPage={actions.goToPage}
                  selectedFile={state.selectedFile}
                  selectedPreviewUrl={derived.selectedPreviewUrl}
                  recentSearches={state.recentSearches}
                  onClearRecentSearches={actions.clearRecentSearches}
                  resultViewMode={state.resultViewMode}
                  activeKinds={state.activeKinds}
                  isHydrating={state.isHydrating}
                  isSearching={state.isSearching}
                  isRefiningSearch={state.isRefiningSearch}
                  savedResultPaths={derived.savedResultPaths}
                  onQuerySelect={actions.setQuery}
                  onSetViewMode={actions.setResultViewMode}
                  onToggleKindFilter={actions.toggleKindFilter}
                  onClearKindFilters={actions.clearKindFilters}
                  onSelectResult={actions.showSearchPreview}
                  onToggleSavedResult={actions.toggleSavedResult}
                  onOpenFile={actions.handleOpenFile}
                  onRevealFile={actions.handleRevealFile}
                  showScoreBreakdown={state.settings.showScoreBreakdown}
                  message={state.message}
                />
              )}

              {state.currentView === "sources" && (
                <SourcesView
                  roots={state.roots}
                  statuses={state.statuses}
                  totalFiles={derived.totalFiles}
                  totalContentIndexed={derived.totalContentIndexed}
                  totalContentPending={derived.totalContentPending}
                  totalSemanticIndexed={derived.totalSemanticIndexed}
                  totalSemanticPending={derived.totalSemanticPending}
                  runningIndexCount={derived.runningIndexCount}
                  selectedRootIds={state.selectedRootIds}
                  toggleRoot={actions.toggleRoot}
                  onAddFolder={actions.handleAddFolder}
                  onRescan={actions.handleRescan}
                  onRescanAll={actions.handleRescanAll}
                  onRemoveRoot={actions.handleRemoveRoot}
                />
              )}

              {state.currentView === "settings" && (
                <SettingsView
                  headerTitle={derived.headerTitle}
                  totalFiles={derived.totalFiles}
                  roots={state.roots}
                  currentStatusText={derived.currentStatusText}
                  draftSettings={state.draftSettings}
                  onUpdateSettings={actions.updateDraftSettings}
                  onTestGeminiKey={actions.testGeminiKey}
                  onRebuildEmbeddings={actions.rebuildAllEmbeddings}
                  onDiagnoseEmbeddings={actions.diagnoseEmbeddings}
                />
              )}
            </div>
          </div>
        </main>
      </div>
      {pendingSettingsExit && (
        <UnsavedSettingsDialog
          isSaving={state.isSavingSettings}
          saveError={state.settingsSaveError}
          onSave={() => void handleSaveAndExit()}
          onDiscard={() => void handleDiscardAndExit()}
          onCancel={() => setPendingSettingsExit(null)}
        />
      )}
    </div>
  );
}

function UnsavedSettingsDialog({
  isSaving,
  saveError,
  onSave,
  onDiscard,
  onCancel,
}: {
  isSaving: boolean;
  saveError: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[#11141d]/54 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-settings-title"
    >
      <div className="w-full max-w-lg rounded-[28px] border border-white/20 bg-[#fdfcf9] p-6 shadow-[0_30px_90px_rgba(16,18,26,0.34)]">
        <h2 id="unsaved-settings-title" className="display-type text-[2rem] text-[#202724]">
          Save settings?
        </h2>
        <p className="mt-3 text-sm leading-7 text-[#6d7470]">
          You have unsaved settings. Save them before leaving, discard the changes, or stay here to keep editing.
        </p>
        {saveError ? <p className="mt-3 text-sm text-[#c24b3a]">{saveError}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className={buttonClass} onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button className={buttonClass} onClick={onDiscard} disabled={isSaving}>
            Discard changes
          </button>
          <button className={primaryButtonClass} onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
