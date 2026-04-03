export const SEARCH_PLACEHOLDERS = [
  "passport photo",
  "tax return 2024",
  "typescript config",
  "invoice from Acme",
];

export const SUGGESTIONS = [
  "passport photo",
  "contract draft",
  "quarterly budget",
  "typescript config",
];

export const FILE_TYPE_FILTERS = ["document", "image", "text", "code", "other"] as const;

export const PAGE_SIZE = 10;

export const RECENT_SEARCHES_KEY = "mira.recent-searches";
export const RESULT_VIEW_MODE_KEY = "mira.result-view-mode";
export const FILE_TYPE_FILTERS_KEY = "mira.file-type-filters";
export const SAVED_RESULTS_KEY = "mira.saved-results";

export const panelClass =
  "rounded-[30px] border border-black/5 bg-white/78 shadow-[0_22px_60px_rgba(85,93,122,0.08)] backdrop-blur-xl";
export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-[18px] border border-black/8 bg-white/80 px-4 py-3 text-sm font-medium text-[#1f2723] transition hover:-translate-y-0.5 hover:bg-white";
export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-[18px] bg-[#737792] px-5 py-3.5 text-sm font-medium text-white shadow-[0_16px_30px_rgba(115,119,146,0.18)] transition hover:-translate-y-0.5 hover:bg-[#676b86]";
