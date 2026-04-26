import { useState } from "react";
import { buttonClass, panelClass } from "../app/constants";
import type { AppSettings, EmbeddingDiagnostics, IndexedRoot } from "../app/types";
import { OverviewCard } from "../components/cards";
import { cx } from "../lib/appHelpers";

const REFRESH_OPTIONS = [
  { value: 0, label: "Manual only" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Every 24 hours" },
] as const;

export interface SettingsViewProps {
  headerTitle: string;
  totalFiles: number;
  roots: IndexedRoot[];
  currentStatusText: string;
  draftSettings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onTestGeminiKey: (apiKey: string) => Promise<boolean>;
  onRebuildEmbeddings: () => Promise<void>;
  onDiagnoseEmbeddings: () => Promise<EmbeddingDiagnostics | null>;
}

export function SettingsView({
  headerTitle,
  totalFiles,
  roots,
  currentStatusText,
  draftSettings,
  onUpdateSettings,
  onTestGeminiKey,
  onRebuildEmbeddings,
  onDiagnoseEmbeddings,
}: SettingsViewProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<"idle" | "testing" | "valid" | "invalid">(
    "idle",
  );
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [diag, setDiag] = useState<EmbeddingDiagnostics | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function updateLocal(patch: Partial<AppSettings>) {
    onUpdateSettings(patch);
    setKeyTestResult("idle");
  }

  async function handleTestKey() {
    const key = draftSettings.geminiApiKey;
    if (!key) return;
    setKeyTestResult("testing");
    const ok = await onTestGeminiKey(key);
    setKeyTestResult(ok ? "valid" : "invalid");
  }

  async function handleRebuild() {
    setIsRebuilding(true);
    try {
      await onRebuildEmbeddings();
    } finally {
      setIsRebuilding(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="px-1 pt-2">
        <p className="text-[0.82rem] uppercase tracking-[0.22em] text-[#727792]">{headerTitle}</p>
        <h1 className="display-type mt-4 text-[clamp(2.5rem,5vw,3.8rem)] leading-[0.96] text-[#242b28]">
          Workspace settings
        </h1>
        <p className="mt-4 max-w-3xl text-[1.08rem] leading-8 text-[#6a716d]">
          Choose how Mira prepares smarter search and keeps your folders up to date.
        </p>
      </section>

      {/* Embedding Model */}
      <section className={cx(panelClass, "p-6")}>
        <h2 className="display-type text-[1.8rem] text-[#202724]">Embedding model</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
          Choose which model generates vector embeddings for semantic search. Switching models
          rebuilds the entire vector index.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <ProviderCard
            selected={draftSettings.embeddingProvider === "local"}
            onClick={() => updateLocal({ embeddingProvider: "local" })}
            title="Local (Nomic Embed v1.5)"
            description="Runs entirely on your device. File contents stay on your machine."
            badge="768d"
          />
          <ProviderCard
            selected={draftSettings.embeddingProvider === "gemini"}
            onClick={() => updateLocal({ embeddingProvider: "gemini" })}
            title="Gemini API"
            description="Uses Google's API for text and image matching. File content needed for embeddings is sent to Google."
            badge="768d"
          />
        </div>
      </section>

      {/* Gemini API Key */}
      {draftSettings.embeddingProvider === "gemini" && (
        <section className={cx(panelClass, "p-6")}>
          <h2 className="display-type text-[1.8rem] text-[#202724]">Gemini API key</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
            Obtain a key from{" "}
            <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" className="font-medium text-[#4a4e6a]">aistudio.google.com/api-keys</a> and paste it here.
            Your key is stored locally. When Gemini is selected, Mira sends file content needed for embeddings to Google's API.
          </p>  

          <div className="mt-5 flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type={showApiKey ? "text" : "password"}
                value={draftSettings.geminiApiKey ?? ""}
                onChange={(e) => updateLocal({ geminiApiKey: e.target.value || null })}
                placeholder="AIza..."
                className="w-full rounded-[14px] border border-black/8 bg-white/90 px-4 py-3 pr-20 text-sm text-[#1f2723] outline-none transition focus:border-[#737792] focus:ring-1 focus:ring-[#737792]/30"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-[#737792] transition hover:bg-[#eef0f8]"
              >
                {showApiKey ? "Hide" : "Show"}
              </button>
            </div>
            <button className={buttonClass} onClick={() => void handleTestKey()}>
              {keyTestResult === "testing" ? "Testing..." : "Test key"}
            </button>
          </div>

          {keyTestResult === "valid" && (
            <p className="mt-3 text-sm text-[#2d8659]">API key is valid.</p>
          )}
          {keyTestResult === "invalid" && (
            <p className="mt-3 text-sm text-[#c24b3a]">
              API key is invalid or could not connect.
            </p>
          )}
        </section>
      )}

      {/* Index Refresh */}
      <section className={cx(panelClass, "p-6")}>
        <h2 className="display-type text-[1.8rem] text-[#202724]">Index refresh</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
          How often Mira should automatically re-scan all connected sources. Live folder watching
          picks up most changes quickly; this controls full refreshes.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {REFRESH_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateLocal({ indexRefreshMinutes: option.value })}
              className={cx(
                "rounded-[14px] border px-4 py-2.5 text-sm font-medium transition",
                draftSettings.indexRefreshMinutes === option.value
                  ? "border-[#737792] bg-[#737792] text-white shadow-[0_8px_20px_rgba(115,119,146,0.18)]"
                  : "border-black/8 bg-white/80 text-[#1f2723] hover:bg-white",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {/* Workspace Overview */}
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
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setShowAdvanced((value) => !value)}
          aria-expanded={showAdvanced}
        >
          <div>
            <h2 className="display-type text-[1.8rem] text-[#202724]">Advanced</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
              Maintenance tools for rebuilding and checking the search index.
            </p>
          </div>
          <span className="rounded-full bg-[#eef0f8] px-3 py-1 text-sm font-medium text-[#5a5e7a]">
            {showAdvanced ? "Hide" : "Show"}
          </span>
        </button>

        {showAdvanced && (
          <div className="mt-6 space-y-5">
            <div className="rounded-[20px] border border-black/5 bg-[#fbfaf7] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="display-type text-[1.45rem] text-[#202724]">Ranking details</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
                    Show score breakdowns in search results when debugging ranking quality.
                  </p>
                </div>
                <button
                  type="button"
                  className={cx(
                    "relative h-8 w-14 rounded-full transition",
                    draftSettings.showScoreBreakdown ? "bg-[#737792]" : "bg-[#d9dce3]",
                  )}
                  onClick={() =>
                    updateLocal({ showScoreBreakdown: !draftSettings.showScoreBreakdown })
                  }
                  aria-pressed={draftSettings.showScoreBreakdown}
                  aria-label="Show score breakdowns"
                >
                  <span
                    className={cx(
                      "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition",
                      draftSettings.showScoreBreakdown ? "left-7" : "left-1",
                    )}
                  />
                </button>
              </div>
            </div>

            <div className="rounded-[20px] border border-black/5 bg-[#fbfaf7] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="display-type text-[1.45rem] text-[#202724]">Search index check</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
                    Check whether text and image matching data is present.
                  </p>
                </div>
                <button
                  className={buttonClass}
                  onClick={() => {
                    setIsDiagnosing(true);
                    void onDiagnoseEmbeddings().then((result) => {
                      setDiag(result);
                      setIsDiagnosing(false);
                    });
                  }}
                  disabled={isDiagnosing}
                >
                  {isDiagnosing ? "Checking..." : diag ? "Check again" : "Check index"}
                </button>
              </div>

              {diag && (
                <div className="mt-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <DiagStat label="Total" value={diag.totalVectors} />
                    <DiagStat label="Text" value={diag.textVectors} />
                    <DiagStat label="Images" value={diag.imageVectors} />
                    <DiagStat label="Other" value={diag.otherVectors} />
                  </div>

                  {diag.imageVectors === 0 && diag.totalVectors > 0 && (
                    <p className="rounded-[14px] border border-[#e8c4bc]/40 bg-[#fefaf9] px-4 py-3 text-sm text-[#b04a3a]">
                      Image matching is not ready yet. Rebuild the search index to prepare images again.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-[20px] border border-[#e8c4bc]/40 bg-[#fefaf9] p-5">
              <h3 className="display-type text-[1.45rem] text-[#202724]">Rebuild search index</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d7470]">
                Re-process every indexed file. This can help after switching providers or when results feel stale.
              </p>
              <button
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-[18px] border border-[#d4958a]/30 bg-white px-5 py-3.5 text-sm font-medium text-[#b04a3a] transition hover:-translate-y-0.5 hover:bg-[#fff5f3]"
                onClick={() => void handleRebuild()}
                disabled={isRebuilding}
              >
                {isRebuilding ? "Rebuilding..." : "Rebuild index"}
              </button>
            </div>
          </div>
        )}
      </section>

    </div>
  );
}

function ProviderCard({
  selected,
  onClick,
  title,
  description,
  badge,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-[20px] border-2 p-5 text-left transition",
        selected
          ? "border-[#737792] bg-[#f6f5fa] shadow-[0_8px_20px_rgba(115,119,146,0.10)]"
          : "border-transparent bg-[#faf9f6] hover:border-black/6",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cx(
            "h-4 w-4 rounded-full border-2 transition",
            selected ? "border-[#737792] bg-[#737792]" : "border-[#c0c4cc] bg-white",
          )}
        >
          {selected && (
            <div className="mt-[3px] ml-[3px] h-1.5 w-1.5 rounded-full bg-white" />
          )}
        </div>
        <span className="text-sm font-semibold text-[#202724]">{title}</span>
        <span className="ml-auto rounded-full bg-[#eef0f8] px-2 py-0.5 text-[0.7rem] font-medium text-[#5a5e7a]">
          {badge}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#6d7470]">{description}</p>
    </button>
  );
}

function DiagStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[14px] border border-black/5 bg-[#fbfaf7] px-4 py-3">
      <p className="text-[0.68rem] uppercase tracking-[0.12em] text-[#7c8187]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[#202724]">{value.toLocaleString()}</p>
    </div>
  );
}
