export type IndexedRoot = {
  id: number;
  path: string;
  status: string;
  syncStatus: string;
  fileCount: number;
  contentIndexedCount: number;
  contentPendingCount: number;
  semanticIndexedCount: number;
  semanticPendingCount: number;
  lastIndexedAt: number | null;
  lastSyncedAt: number | null;
  lastChangeAt: number | null;
  lastError: string | null;
};

export type ScoreBreakdown = {
  metadata: number;
  lexical: number;
  semanticText: number;
  semanticImage: number;
  recency: number;
  total: number;
};

export type IndexStatus = {
  jobId: number;
  rootId: number;
  phase: string;
  status: string;
  processed: number;
  total: number;
  currentPath: string | null;
  errors: string[];
  startedAt: number;
  finishedAt: number | null;
};

export type SearchResult = {
  fileId: number;
  rootId: number;
  name: string;
  path: string;
  extension: string;
  kind: string;
  size: number;
  modifiedAt: number | null;
  indexedAt: number;
  score: number;
  semanticScore: number | null;
  scoreBreakdown: ScoreBreakdown;
  matchReasons: string[];
  snippet: string | null;
  snippetSource: string | null;
  previewPath: string | null;
};

export type FileDetails = {
  fileId: number;
  rootId: number;
  rootPath: string;
  name: string;
  path: string;
  extension: string;
  kind: string;
  size: number;
  modifiedAt: number | null;
  indexedAt: number;
  previewPath: string | null;
  contentStatus: string | null;
  contentSnippet: string | null;
  contentSource: string | null;
  extractionError: string | null;
  semanticStatus: string | null;
  semanticModality: string | null;
  semanticModel: string | null;
  semanticSummary: string | null;
  semanticError: string | null;
};

export type SearchRequest = {
  query: string;
  rootIds?: number[];
  limit?: number;
};

export type SavedResult = {
  path: string;
  name: string;
  kind: string;
  extension: string;
  modifiedAt: number | null;
  savedAt: number;
};

export type ViewName = "home" | "results" | "sources" | "settings";
export type ResultViewMode = "list" | "grid";
export type PreviewSource = "search" | "saved" | null;

export type AppControllerState = {
  roots: IndexedRoot[];
  statuses: Record<number, IndexStatus>;
  recentSearches: string[];
  savedResults: SavedResult[];
  selectedRootIds: number[];
  activeKinds: string[];
  query: string;
  resultViewMode: ResultViewMode;
  selectedFile: FileDetails | null;
  currentView: ViewName;
  isHydrating: boolean;
  isSearching: boolean;
  message: string | null;
};

export type AppControllerDerived = {
  totalFiles: number;
  totalContentIndexed: number;
  totalContentPending: number;
  totalSemanticIndexed: number;
  totalSemanticPending: number;
  runningIndexCount: number;
  selectedPreviewUrl: string | null;
  visibleResults: SearchResult[];
  pinnedRoots: IndexedRoot[];
  savedResultPaths: Set<string>;
  currentStatusText: string;
  headerTitle: string;
};

export type AppControllerActions = {
  setQuery: (value: string) => void;
  setCurrentView: (view: ViewName) => void;
  setResultViewMode: (mode: ResultViewMode) => void;
  showSearchPreview: (fileId: number) => Promise<void>;
  handleShowSavedResult: (path: string) => Promise<void>;
  toggleSavedResult: (
    result: Pick<SavedResult, "path" | "name" | "kind" | "extension" | "modifiedAt">,
  ) => void;
  removeSavedResult: (path: string) => void;
  handleAddFolder: () => Promise<void>;
  handleRescan: (rootId: number) => Promise<void>;
  handleRescanAll: () => Promise<void>;
  handleRemoveRoot: (rootId: number) => Promise<void>;
  handleOpenFile: (path: string) => Promise<void>;
  handleRevealFile: (path: string) => Promise<void>;
  toggleRoot: (rootId: number) => void;
  toggleKindFilter: (kind: string) => void;
  clearKindFilters: () => void;
};

export type AppControllerRefs = {
  bindHomePreviewNode: (node: HTMLDivElement | null) => void;
};

export type AppController = {
  state: AppControllerState;
  derived: AppControllerDerived;
  actions: AppControllerActions;
  refs: AppControllerRefs;
};
