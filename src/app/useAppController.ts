import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  FILE_TYPE_FILTERS_KEY,
  RECENT_SEARCHES_KEY,
  RESULT_VIEW_MODE_KEY,
  SAVED_RESULTS_KEY,
} from "./constants";
import type {
  AppController,
  FileDetails,
  IndexStatus,
  IndexedRoot,
  PreviewSource,
  ResultViewMode,
  SavedResult,
  SearchRequest,
  SearchResult,
  ViewName,
} from "./types";
import { getErrorMessage, readStoredList, readStoredSavedResults } from "../lib/appHelpers";

export function useAppController(): AppController {
  const [roots, setRoots] = useState<IndexedRoot[]>([]);
  const [statuses, setStatuses] = useState<Record<number, IndexStatus>>({});
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [selectedRootIds, setSelectedRootIds] = useState<number[]>([]);
  const [activeKinds, setActiveKinds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>("list");
  const [selectedResultFileId, setSelectedResultFileId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileDetails | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource>(null);
  const [currentView, setCurrentView] = useState<ViewName>("home");
  const [isHydrating, setIsHydrating] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const homePreviewRef = useRef<HTMLDivElement | null>(null);
  const resultsPreviewRef = useRef<HTMLDivElement | null>(null);

  const filteredRootIds = selectedRootIds.length > 0 ? selectedRootIds : undefined;
  const activeStatuses = useMemo(
    () => roots.map((root) => statuses[root.id]).filter(Boolean),
    [roots, statuses],
  );
  const runningIndexCount = activeStatuses.filter(
    (status) => status.status === "running",
  ).length;
  const totalFiles = roots.reduce((total, root) => total + root.fileCount, 0);
  const totalContentIndexed = roots.reduce(
    (total, root) => total + root.contentIndexedCount,
    0,
  );
  const totalContentPending = roots.reduce(
    (total, root) => total + root.contentPendingCount,
    0,
  );
  const totalSemanticIndexed = roots.reduce(
    (total, root) => total + root.semanticIndexedCount,
    0,
  );
  const totalSemanticPending = roots.reduce(
    (total, root) => total + root.semanticPendingCount,
    0,
  );
  const activeRootCount = roots.filter((root) => root.status === "ready").length;
  const enrichingRootCount = roots.filter(
    (root) => root.contentPendingCount > 0 || root.semanticPendingCount > 0,
  ).length;
  const selectedPreviewUrl =
    selectedFile?.previewPath ? convertFileSrc(selectedFile.previewPath) : null;
  const visibleResults = useMemo(() => {
    if (activeKinds.length === 0) {
      return results;
    }

    return results.filter((result) => activeKinds.includes(result.kind));
  }, [activeKinds, results]);
  const featuredResult = visibleResults[0] ?? null;
  const secondaryResults = visibleResults.slice(1, 4);
  const listResults = visibleResults.slice(4);
  const pinnedRoots = roots.slice(0, 3);
  const savedResultPaths = useMemo(
    () => new Set(savedResults.map((result) => result.path)),
    [savedResults],
  );
  const currentStatusText =
    runningIndexCount > 0
      ? `${runningIndexCount} source${runningIndexCount === 1 ? "" : "s"} indexing`
      : enrichingRootCount > 0
        ? `${enrichingRootCount} source${enrichingRootCount === 1 ? "" : "s"} enriching`
        : activeRootCount > 0
          ? "Index is active"
          : "Waiting for sources";
  const headerTitle =
    currentView === "results" && query.trim().length > 0
      ? "Search analysis"
      : currentView === "sources"
        ? "Sources & indexing"
        : currentView === "settings"
          ? "Workspace settings"
          : "Workspace";

  useEffect(() => {
    setRecentSearches(readStoredList(RECENT_SEARCHES_KEY));
    setActiveKinds(readStoredList(FILE_TYPE_FILTERS_KEY));
    setSavedResults(readStoredSavedResults(SAVED_RESULTS_KEY));
    const storedView = window.localStorage.getItem(RESULT_VIEW_MODE_KEY);
    if (storedView === "list" || storedView === "grid") {
      setResultViewMode(storedView);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(query, filteredRootIds);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [query, filteredRootIds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshStatuses();
    }, 1500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (query.trim().length > 0 && currentView !== "results") {
      setCurrentView("results");
    }
  }, [query, currentView]);

  useEffect(() => {
    if (visibleResults.length === 0) {
      setSelectedResultFileId(null);
      if (previewSource === "search") {
        setSelectedFile(null);
      }
      return;
    }

    if (
      selectedResultFileId === null ||
      !visibleResults.some((result) => result.fileId === selectedResultFileId)
    ) {
      setSelectedResultFileId(visibleResults[0].fileId);
    }
  }, [previewSource, selectedResultFileId, visibleResults]);

  useEffect(() => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches));
  }, [recentSearches]);

  useEffect(() => {
    window.localStorage.setItem(FILE_TYPE_FILTERS_KEY, JSON.stringify(activeKinds));
  }, [activeKinds]);

  useEffect(() => {
    window.localStorage.setItem(RESULT_VIEW_MODE_KEY, resultViewMode);
  }, [resultViewMode]);

  useEffect(() => {
    window.localStorage.setItem(SAVED_RESULTS_KEY, JSON.stringify(savedResults));
  }, [savedResults]);

  useEffect(() => {
    if (selectedResultFileId === null) {
      if (currentView === "results") {
        setPreviewSource(null);
        setSelectedFile(null);
      }
      return;
    }

    if (currentView !== "results" && previewSource === "saved") {
      return;
    }

    void showSearchPreview(selectedResultFileId);
  }, [currentView, selectedResultFileId]);

  async function hydrate() {
    setIsHydrating(true);
    try {
      await Promise.all([loadRoots(), refreshStatuses(), runSearch("", undefined)]);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setIsHydrating(false);
    }
  }

  async function loadRoots() {
    const nextRoots = await invoke<IndexedRoot[]>("list_index_roots");
    setRoots(nextRoots);
  }

  async function refreshStatuses() {
    const [nextStatuses, nextRoots] = await Promise.all([
      invoke<IndexStatus[]>("get_index_statuses"),
      invoke<IndexedRoot[]>("list_index_roots"),
    ]);

    const statusMap = nextStatuses.reduce<Record<number, IndexStatus>>((acc, status) => {
      acc[status.rootId] = status;
      return acc;
    }, {});

    setStatuses(statusMap);
    setRoots(nextRoots);
  }

  async function runSearch(nextQuery: string, rootIds?: number[]) {
    setIsSearching(true);
    try {
      const payload: SearchRequest = {
        query: nextQuery,
        limit: 60,
      };

      if (rootIds && rootIds.length > 0) {
        payload.rootIds = rootIds;
      }

      const nextResults = await invoke<SearchResult[]>("search_files", { request: payload });
      setResults(nextResults);
      if (nextQuery.trim().length >= 2) {
        setRecentSearches((current) => {
          const normalized = nextQuery.trim();
          return [normalized, ...current.filter((entry) => entry !== normalized)].slice(0, 8);
        });
      }
      setMessage(null);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setIsSearching(false);
    }
  }

  async function loadFileDetails(fileId: number) {
    try {
      const details = await invoke<FileDetails>("get_file_details", { fileId });
      setMessage(null);
      return details;
    } catch (error) {
      setMessage(getErrorMessage(error));
      return null;
    }
  }

  async function loadFileDetailsByPath(path: string) {
    try {
      const details = await invoke<FileDetails | null>("get_file_details_by_path", { path });
      setMessage(null);
      return details;
    } catch (error) {
      setMessage(getErrorMessage(error));
      return null;
    }
  }

  function focusPreviewPanel(target: { current: HTMLDivElement | null }) {
    window.requestAnimationFrame(() => {
      target.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      target.current?.focus({ preventScroll: true });
    });
  }

  async function showSearchPreview(fileId: number) {
    setSelectedResultFileId(fileId);
    const details = await loadFileDetails(fileId);
    if (!details) {
      return;
    }

    setPreviewSource("search");
    setSelectedFile(details);
  }

  async function handleOpenPreview(fileId: number) {
    setCurrentView("results");
    await showSearchPreview(fileId);
    focusPreviewPanel(resultsPreviewRef);
  }

  async function handleShowSavedResult(path: string) {
    const details = await loadFileDetailsByPath(path);

    if (!details) {
      setPreviewSource("saved");
      setSelectedFile(null);
      setMessage(
        "This saved result is no longer indexed. Re-index its source or remove the bookmark.",
      );
      focusPreviewPanel(homePreviewRef);
      return;
    }

    setPreviewSource("saved");
    setSelectedResultFileId(details.fileId);
    setSelectedFile(details);
    setMessage(null);
    focusPreviewPanel(homePreviewRef);
  }

  function toggleSavedResult(
    result: Pick<SavedResult, "path" | "name" | "kind" | "extension" | "modifiedAt">,
  ) {
    setSavedResults((current) => {
      const alreadySaved = current.some((entry) => entry.path === result.path);

      if (alreadySaved) {
        return current.filter((entry) => entry.path !== result.path);
      }

      return [
        {
          ...result,
          savedAt: Date.now(),
        },
        ...current.filter((entry) => entry.path !== result.path),
      ];
    });
  }

  function removeSavedResult(path: string) {
    setSavedResults((current) => current.filter((entry) => entry.path !== path));
    setMessage(null);
    if (previewSource === "saved" && selectedFile?.path === path) {
      setPreviewSource(null);
      setSelectedFile(null);
    }
  }

  async function handleAddFolder() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose a folder to index",
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const root = await invoke<IndexedRoot>("add_index_root", { path: selected });
      await invoke("start_index", { rootId: root.id });
      setCurrentView("sources");
      await Promise.all([loadRoots(), refreshStatuses(), runSearch(query, filteredRootIds)]);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleRescan(rootId: number) {
    try {
      await invoke("start_index", { rootId });
      await refreshStatuses();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleRescanAll() {
    try {
      await Promise.all(roots.map((root) => invoke("start_index", { rootId: root.id })));
      await refreshStatuses();
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleRemoveRoot(rootId: number) {
    try {
      await invoke("remove_index_root", { rootId });
      const nextSelected = selectedRootIds.filter((id) => id !== rootId);
      setSelectedRootIds(nextSelected);
      await Promise.all([
        loadRoots(),
        refreshStatuses(),
        runSearch(query, nextSelected.length > 0 ? nextSelected : undefined),
      ]);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleOpenFile(path: string) {
    try {
      await invoke("open_file", { path });
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function handleRevealFile(path: string) {
    try {
      await invoke("reveal_file", { path });
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  function toggleRoot(rootId: number) {
    setSelectedRootIds((current) =>
      current.includes(rootId)
        ? current.filter((id) => id !== rootId)
        : [...current, rootId],
    );
  }

  function toggleKindFilter(kind: string) {
    setActiveKinds((current) =>
      current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind],
    );
  }

  function clearKindFilters() {
    setActiveKinds([]);
  }

  return {
    state: {
      roots,
      statuses,
      recentSearches,
      savedResults,
      selectedRootIds,
      activeKinds,
      query,
      resultViewMode,
      selectedFile,
      currentView,
      isHydrating,
      isSearching,
      message,
    },
    derived: {
      totalFiles,
      totalContentIndexed,
      totalContentPending,
      totalSemanticIndexed,
      totalSemanticPending,
      runningIndexCount,
      selectedPreviewUrl,
      visibleResults,
      featuredResult,
      secondaryResults,
      listResults,
      pinnedRoots,
      savedResultPaths,
      currentStatusText,
      headerTitle,
    },
    actions: {
      setQuery,
      setCurrentView,
      setResultViewMode,
      showSearchPreview,
      handleOpenPreview,
      handleShowSavedResult,
      toggleSavedResult,
      removeSavedResult,
      handleAddFolder,
      handleRescan,
      handleRescanAll,
      handleRemoveRoot,
      handleOpenFile,
      handleRevealFile,
      toggleRoot,
      toggleKindFilter,
      clearKindFilters,
    },
    refs: {
      bindHomePreviewNode: (node) => {
        homePreviewRef.current = node;
      },
      bindResultsPreviewNode: (node) => {
        resultsPreviewRef.current = node;
      },
    },
  };
}
