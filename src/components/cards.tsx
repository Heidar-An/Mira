import { panelClass } from "../app/constants";
import { cx } from "../lib/appHelpers";

export interface OverviewCardProps {
  label: string;
  value: string;
  meta: string;
}

export function OverviewCard({ label, value, meta }: OverviewCardProps) {
  return (
    <div className="rounded-[24px] bg-[#faf9f6] p-5">
      <p className="text-[0.75rem] uppercase tracking-[0.14em] text-[#7c8187]">{label}</p>
      <p className="display-type mt-3 text-[1.9rem] leading-tight text-[#202724]">{value}</p>
      <p className="mt-3 text-sm leading-6 text-[#6d7470]">{meta}</p>
    </div>
  );
}

export interface MetricPanelProps {
  title: string;
  value: string;
  note: string;
  bar?: number;
  segmented?: boolean;
  indicator?: boolean;
}

export function MetricPanel({
  title,
  value,
  note,
  bar,
  segmented,
  indicator,
}: MetricPanelProps) {
  return (
    <div className={cx(panelClass, "p-6")}>
      <p className="text-[0.75rem] uppercase tracking-[0.14em] text-[#7c8187]">{title}</p>
      <div className="mt-4 flex items-end gap-3">
        <p className="display-type text-[2.3rem] leading-none text-[#202724]">{value}</p>
        {indicator ? <span className="mb-1 h-4 w-4 rounded-full bg-[#74d2b8]" /> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-[#6d7470]">{note}</p>
      {typeof bar === "number" ? (
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#e6e7ea]">
          <div className="h-full rounded-full bg-[#737792]" style={{ width: `${bar}%` }} />
        </div>
      ) : null}
      {segmented ? (
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[32, 28, 22, 18].map((width) => (
            <div
              key={width}
              className="h-2 rounded-full bg-[#dfe1e7]"
              style={{ width: `${width * 3}%` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface PassProgressRowProps {
  label: string;
  value: string;
  progress: number;
  tone: "primary" | "secondary" | "muted";
}

export function PassProgressRow({
  label,
  value,
  progress,
  tone,
}: PassProgressRowProps) {
  const fillClass =
    tone === "primary"
      ? "bg-[#737792]"
      : tone === "secondary"
        ? "bg-[#8e93ad]"
        : "bg-[#c8ccd9]";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm text-[#70767a]">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e5e6ea]">
        <div
          className={cx("h-full rounded-full transition-[width]", fillClass)}
          style={{ width: `${Math.max(progress, progress > 0 ? 6 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export interface InfoRowProps {
  label: string;
  value: string;
}

export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="grid gap-1">
      <dt className="text-[0.72rem] uppercase tracking-[0.14em] text-[#7c8187]">{label}</dt>
      <dd className="wrap-anywhere min-w-0 text-[#252c29]">{value}</dd>
    </div>
  );
}

export interface StatusNoticeProps {
  tone: "warning" | "danger";
  title: string;
  body: string;
}

export function StatusNotice({ tone, title, body }: StatusNoticeProps) {
  const className =
    tone === "danger"
      ? "rounded-[20px] bg-[#fff3ef] px-4 py-3 text-sm text-[color:var(--danger)]"
      : "rounded-[20px] bg-[#fff7e8] px-4 py-3 text-sm text-[#8b6322]";

  return (
    <div className={className}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 leading-6">{body}</p>
    </div>
  );
}
