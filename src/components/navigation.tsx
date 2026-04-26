import type { ReactNode } from "react";
import { cx } from "../lib/appHelpers";

export interface SidebarLinkProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}

export function SidebarLink({
  label,
  icon,
  active,
  onClick,
  badge,
}: SidebarLinkProps) {
  return (
    <button
      className={cx(
        "flex w-full items-center justify-between rounded-[18px] px-4 py-3.5 text-left text-[1.02rem] transition",
        active
          ? "bg-white text-[#4d5577] shadow-[0_8px_20px_rgba(85,93,122,0.08)]"
          : "text-[#595f63] hover:bg-white/70",
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-3">
        <span className={cx("text-[#737792]", active && "text-[#5a6386]")}>{icon}</span>
        {label}
      </span>
      {badge ? (
        <span className="rounded-full bg-[#eef0f5] px-2 py-0.5 text-xs text-[#737792]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export interface TopChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function TopChip({ label, active, onClick }: TopChipProps) {
  return (
    <button
      className={cx(
        "rounded-full px-4 py-2 transition",
        active ? "bg-[#f3f0ea] text-[#232a27]" : "text-[#73797e] hover:bg-[#f7f4ef]",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
