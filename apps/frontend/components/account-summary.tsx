"use client";

import type { User } from "@outcomes/shared-types";
import clsx from "clsx";

type AccountSummaryProps = {
  user: User | null;
  className?: string;
  variant?: "header" | "panel";
};

function getInitials(user: User): string {
  const nameParts = user.full_name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const initials = nameParts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return initials || user.email.charAt(0).toUpperCase() || "U";
}

function formatRole(role: User["role"]): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AccountSummary({ user, className, variant = "header" }: AccountSummaryProps) {
  if (!user) return null;

  const isHeader = variant === "header";

  return (
    <div
      aria-label={`Signed in as ${user.full_name}`}
      className={clsx(
        "items-center gap-3 rounded-2xl border border-[#e6dcf3] bg-white/80 shadow-[0_18px_34px_-30px_rgba(36,31,67,0.6)] backdrop-blur",
        isHeader ? "hidden px-3 py-2 sm:flex" : "flex px-3.5 py-3",
        className
      )}
    >
      <div
        className={clsx(
          "flex shrink-0 items-center justify-center rounded-full bg-[#241f43] font-semibold text-white",
          isHeader ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm"
        )}
      >
        {getInitials(user)}
      </div>
      <div className="min-w-0 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <p className={clsx("truncate font-semibold text-[#241f43]", isHeader ? "max-w-[150px] text-sm" : "max-w-[190px] text-sm")}>
            {user.full_name}
          </p>
          <span className="shrink-0 rounded-full border border-[#ded3ee] bg-[#f7f3fb] px-2 py-0.5 text-[11px] font-semibold text-[#6b6285]">
            {formatRole(user.role)}
          </span>
        </div>
        <p className={clsx("truncate text-[#706a87]", isHeader ? "max-w-[220px] text-xs" : "max-w-[240px] text-xs")}>
          {user.email}
        </p>
      </div>
    </div>
  );
}
