import type {
  FileDetails,
  IndexedRoot,
  IndexStatus,
  SavedResult,
  ScoreBreakdown,
} from "../app/types";

export function statusLabel(status: string) {
  switch (status) {
    case "indexing":
      return "Indexing";
    case "ready":
      return "Ready";
    case "error":
      return "Needs attention";
    default:
      return "Idle";
  }
}

export function statusPillClass(status: string) {
  switch (status) {
    case "ready":
      return "inline-flex items-center rounded-full bg-[#e7f6f0] px-3 py-1 text-sm font-medium text-[#24604a]";
    case "indexing":
      return "inline-flex items-center rounded-full bg-[#f7efe0] px-3 py-1 text-sm font-medium text-[#8b6322]";
    case "error":
      return "inline-flex items-center rounded-full bg-[#fff0ec] px-3 py-1 text-sm font-medium text-[#9a4d3a]";
    default:
      return "inline-flex items-center rounded-full bg-[#f0f1f4] px-3 py-1 text-sm font-medium text-[#72787d]";
  }
}

export function stagePercent(indexed: number, total: number) {
  if (total <= 0) {
    return 100;
  }

  return Math.round((indexed / total) * 100);
}

export function formatPassValue(indexed: number, total: number) {
  if (total <= 0) {
    return "n/a";
  }

  return `${indexed.toLocaleString()} / ${total.toLocaleString()}`;
}

export function rootPipelineLabel(root: IndexedRoot, status?: IndexStatus) {
  if (status?.status === "running") {
    return "Scanning metadata";
  }

  if (root.contentPendingCount > 0) {
    return "Extracting content";
  }

  if (root.semanticPendingCount > 0) {
    return "Enriching semantics";
  }

  if (root.fileCount > 0) {
    return "All passes complete";
  }

  return "Queued";
}

export function syncStatusLabel(status: string) {
  switch (status) {
    case "watching":
      return "Live sync active";
    case "pending":
      return "Changes detected";
    case "syncing":
      return "Applying updates";
    case "error":
      return "Sync needs attention";
    default:
      return "Sync idle";
  }
}

export function freshnessLabel(root: IndexedRoot) {
  if (root.lastChangeAt && (!root.lastSyncedAt || root.lastChangeAt > root.lastSyncedAt)) {
    return "Freshness: updates pending";
  }

  if (root.lastSyncedAt) {
    return "Freshness: current";
  }

  return "Freshness: unknown";
}

export function scoreSummary(scoreBreakdown: ScoreBreakdown, semanticScore?: number | null) {
  const total =
    scoreBreakdown.metadata +
    scoreBreakdown.lexical +
    scoreBreakdown.semanticText +
    scoreBreakdown.semanticImage +
    scoreBreakdown.intent +
    scoreBreakdown.recency;

  const parts = [
    scoreBreakdown.metadata > 0 ? `meta ${scoreBreakdown.metadata}` : null,
    scoreBreakdown.lexical > 0 ? `lex ${scoreBreakdown.lexical}` : null,
    scoreBreakdown.semanticText > 0 ? `sem-t ${scoreBreakdown.semanticText}` : null,
    scoreBreakdown.semanticImage > 0 ? `sem-i ${scoreBreakdown.semanticImage}` : null,
    scoreBreakdown.intent !== 0 ? `intent ${scoreBreakdown.intent}` : null,
    scoreBreakdown.recency > 0 ? `rec ${scoreBreakdown.recency}` : null,
    semanticScore != null ? `sim ${semanticScore.toFixed(3)}` : null,
  ].filter(Boolean);

  const detail = parts.length > 0 ? parts.join(" · ") : "metadata only";
  return `[${total}] ${detail}`;
}

export function contentStatusLabel(status: string | null) {
  switch (status) {
    case "indexed":
      return "Indexed";
    case "empty":
      return "Empty";
    case "error":
      return "Error";
    case "unsupported":
      return "Unsupported";
    default:
      return "Pending";
  }
}

export function semanticStatusLabel(status: string | null) {
  switch (status) {
    case "indexed":
      return "Semantic ready";
    case "empty":
      return "No semantic text";
    case "error":
      return "Semantic error";
    case "unsupported":
      return "Metadata only";
    default:
      return "Semantic pending";
  }
}

export function detailStatusLabel(file: FileDetails) {
  if (file.semanticStatus && file.semanticStatus !== "unsupported") {
    return semanticStatusLabel(file.semanticStatus);
  }

  return contentStatusLabel(file.contentStatus);
}

export function kindLabel(kind: string) {
  switch (kind) {
    case "document":
      return "Document";
    case "image":
      return "Image";
    case "code":
      return "Code";
    case "text":
      return "Text";
    case "archive":
      return "Archive";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "other":
      return "Other";
    default:
      return "File";
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

export function formatRelativeDate(timestamp: number) {
  const days = Math.max(1, Math.round((Date.now() - timestamp * 1000) / (1000 * 60 * 60 * 24)));
  if (days <= 1) {
    return "Today";
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return formatDate(timestamp);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function shortPath(path: string) {
  const parts = path.split("/");
  return parts.slice(-2).join("/") || path;
}

export function readStoredList(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) {
      return [];
    }

    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function readStoredSavedResults(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) {
      return [];
    }

    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSavedResult);
  } catch {
    return [];
  }
}

export function isSavedResult(value: unknown): value is SavedResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SavedResult>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.extension === "string" &&
    (candidate.modifiedAt === null || typeof candidate.modifiedAt === "number") &&
    typeof candidate.savedAt === "number"
  );
}

export function pageNumberFromSource(source: string | null) {
  if (!source) {
    return 1;
  }

  const match = source.match(/Page\s+(\d+)/i);
  return match ? Number(match[1]) : 1;
}

export function buildHighlightSegments(text: string, query: string) {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2);

  if (tokens.length === 0) {
    return [{ text, highlight: false }];
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  return text.split(pattern).filter(Boolean).map((segment) => ({
    text: segment,
    highlight: tokens.some((token) => token === segment.toLowerCase()),
  }));
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
