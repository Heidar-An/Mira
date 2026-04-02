import logoSrc from "../assets/logo.png";
import { SEARCH_PLACEHOLDERS, panelClass, primaryButtonClass } from "./constants";
import { useAppController } from "./useAppController";
import { SidebarLink, TopChip } from "../components/navigation";
import {
  DatabaseIcon,
  HomeIcon,
  PlusIcon,
  ResultsIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from "../components/icons";
import { HomeView } from "../views/HomeView";
import { ResultsView } from "../views/ResultsView";
import { SettingsView } from "../views/SettingsView";
import { SourcesView } from "../views/SourcesView";
import { cx } from "../lib/appHelpers";

export function App() {
  const { state, derived, actions, refs } = useAppController();

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

          <button className={cx(primaryButtonClass, "mt-8 w-full")} onClick={() => void actions.handleAddFolder()}>
            <PlusIcon />
            Add source
          </button>

          <nav className="mt-8 space-y-2">
            <SidebarLink
              label="Home"
              active={state.currentView === "home"}
              onClick={() => actions.setCurrentView("home")}
              icon={<HomeIcon />}
            />
            <SidebarLink
              label="Results"
              active={state.currentView === "results"}
              onClick={() => actions.setCurrentView("results")}
              icon={<ResultsIcon />}
              badge={derived.visibleResults.length > 0 ? derived.visibleResults.length : undefined}
            />
            <SidebarLink
              label="Sources"
              active={state.currentView === "sources"}
              onClick={() => actions.setCurrentView("sources")}
              icon={<DatabaseIcon />}
              badge={state.roots.length > 0 ? state.roots.length : undefined}
            />
            <SidebarLink
              label="Settings"
              active={state.currentView === "settings"}
              onClick={() => actions.setCurrentView("settings")}
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
                ? "Metadata indexing is happening in the background and deeper passes will continue afterward."
                : derived.totalContentPending > 0 || derived.totalSemanticPending > 0
                  ? "Metadata is ready, while content extraction and semantic enrichment are still catching up."
                  : "Your local workspace is ready for metadata, extracted-text, and visual-semantic search."}
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
            <header className="border-b border-black/5 px-5 py-4 sm:px-7">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="relative min-w-0 flex-1">
                    <SearchIcon className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7c8187]" />
                    <input
                      className="w-full rounded-[22px] border border-black/5 bg-[#f7f3ed] py-4 pl-14 pr-5 text-[1.02rem] text-[#1e2522] outline-none transition focus:border-[#d7d1c7] focus:bg-white focus:ring-4 focus:ring-[#7377921a]"
                      value={state.query}
                      onChange={(event) => actions.setQuery(event.target.value)}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={
                        SEARCH_PLACEHOLDERS[
                          Math.floor(Date.now() / 1000) % SEARCH_PLACEHOLDERS.length
                        ]
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-[#6f757d]">
                  <TopChip
                    label="Workspace"
                    active={state.currentView === "home" || state.currentView === "results"}
                    onClick={() =>
                      actions.setCurrentView(state.query.trim().length > 0 ? "results" : "home")
                    }
                  />
                  <TopChip
                    label="Sources"
                    active={state.currentView === "sources"}
                    onClick={() => actions.setCurrentView("sources")}
                  />
                  <TopChip
                    label="Settings"
                    active={state.currentView === "settings"}
                    onClick={() => actions.setCurrentView("settings")}
                  />
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-7 sm:py-7">
              {state.currentView === "home" && (
                <HomeView
                  roots={state.roots}
                  totalFiles={derived.totalFiles}
                  runningIndexCount={derived.runningIndexCount}
                  query={state.query}
                  setQuery={actions.setQuery}
                  setCurrentView={actions.setCurrentView}
                  recentSearches={state.recentSearches}
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
                  results={derived.visibleResults}
                  featuredResult={derived.featuredResult}
                  secondaryResults={derived.secondaryResults}
                  listResults={derived.listResults}
                  selectedFile={state.selectedFile}
                  selectedPreviewUrl={derived.selectedPreviewUrl}
                  recentSearches={state.recentSearches}
                  resultViewMode={state.resultViewMode}
                  activeKinds={state.activeKinds}
                  isHydrating={state.isHydrating}
                  isSearching={state.isSearching}
                  savedResultPaths={derived.savedResultPaths}
                  onQuerySelect={actions.setQuery}
                  onSetViewMode={actions.setResultViewMode}
                  onToggleKindFilter={actions.toggleKindFilter}
                  onClearKindFilters={actions.clearKindFilters}
                  onSelectResult={actions.showSearchPreview}
                  onOpenPreview={actions.handleOpenPreview}
                  onToggleSavedResult={actions.toggleSavedResult}
                  onOpenFile={actions.handleOpenFile}
                  onRevealFile={actions.handleRevealFile}
                  bindSelectedFileNode={refs.bindResultsPreviewNode}
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
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
