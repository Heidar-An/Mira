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
  semanticMedia: number;
  intent: number;
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
  segmentModality: string | null;
  segmentLabel: string | null;
  segmentStartMs: number | null;
  segmentEndMs: number | null;
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
  segmentModality: string | null;
  segmentLabel: string | null;
  segmentStartMs: number | null;
  segmentEndMs: number | null;
  extractionError: string | null;
  semanticStatus: string | null;
  semanticModality: string | null;
  semanticModel: string | null;
  semanticSummary: string | null;
  semanticError: string | null;
};

export type SearchMode = "quick" | "full";

export type SearchRequest = {
  query: string;
  mode: SearchMode;
  rootIds?: number[];
  kinds?: string[];
  limit?: number;
  offset?: number;
};

export type SearchQueryIntent = {
  status: string;
  model: string | null;
  kind: string | null;
  confidence: number | null;
  message: string | null;
};

export type SearchResponse = {
  results: SearchResult[];
  hasMore: boolean;
  queryIntent: SearchQueryIntent | null;
};

export type SavedResult = {
  path: string;
  name: string;
  kind: string;
  extension: string;
  modifiedAt: number | null;
  savedAt: number;
};

export type EmbeddingProvider = "local" | "gemini";

export type AppSettings = {
  embeddingProvider: EmbeddingProvider;
  geminiApiKey: string | null;
  indexRefreshMinutes: number;
  embeddingModelVersion: string | null;
  showScoreBreakdown: boolean;
  ignoreMetadata: boolean;
};

export type EmbeddingDiagEntry = {
  fileId: number;
  modality: string;
  kind: string;
  summary: string;
};

export type EmbeddingDiagnostics = {
  totalVectors: number;
  textVectors: number;
  imageVectors: number;
  audioVectors: number;
  videoVectors: number;
  otherVectors: number;
  sampleEntries: EmbeddingDiagEntry[];
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
  isRefiningSearch: boolean;
  message: string | null;
  settings: AppSettings;
  draftSettings: AppSettings;
  isSavingSettings: boolean;
  settingsSaveError: string | null;
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
  resultsQuery: string;
  resultsQueryIntent: SearchQueryIntent | null;
  currentPage: number;
  hasMore: boolean;
  pinnedRoots: IndexedRoot[];
  savedResultPaths: Set<string>;
  currentStatusText: string;
  headerTitle: string;
  settingsHasChanges: boolean;
};

export type AppControllerActions = {
  setQuery: (value: string) => void;
  setCurrentView: (view: ViewName) => void;
  setResultViewMode: (mode: ResultViewMode) => void;
  clearRecentSearches: () => void;
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
  goToPage: (page: number) => Promise<void>;
  updateDraftSettings: (patch: Partial<AppSettings>) => void;
  saveDraftSettings: () => Promise<AppSettings | null>;
  discardDraftSettings: () => void;
  testGeminiKey: (apiKey: string) => Promise<boolean>;
  rebuildAllEmbeddings: () => Promise<void>;
  diagnoseEmbeddings: () => Promise<EmbeddingDiagnostics | null>;
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
