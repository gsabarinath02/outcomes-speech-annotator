"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import clsx from "clsx";

import { useAuth } from "@/components/auth-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, accessToken, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !accessToken) {
      router.replace("/login");
    }
  }, [accessToken, isLoading, router]);

  if (isLoading || !accessToken) {
    return (
      <main className="oa-page flex min-h-screen items-center justify-center px-4">
        <div className="oa-card px-5 py-4 text-sm text-[#5f5b79]">Loading workspace...</div>
      </main>
    );
  }

  const links = [
    { href: "/tasks", label: "Tasks" },
    { href: "/admin/upload", label: "Admin Upload" }
  ];

  return (
    <div className="oa-page">
      <header className="sticky top-0 z-30 border-b border-[#e8def5] bg-white/80 backdrop-blur-lg">
        <div className="mx-auto max-w-[1360px] px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4 sm:gap-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7c7895]">Outcomes.ai</p>
                <h1 className="oa-title text-sm font-semibold tracking-[0.01em] sm:text-base">
                  Speech Annotator
                </h1>
              </div>

              <nav className="flex items-center gap-1 rounded-xl border border-[#e5daf4] bg-[#f7f2ff] p-1">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={clsx(
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                      pathname.startsWith(link.href)
                        ? "border border-[#d3c1ea] bg-white text-[#1e1a3d] shadow-[0_10px_18px_-16px_rgba(22,19,45,0.88)]"
                        : "text-[#645f7d] hover:bg-white"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden rounded-xl border border-[#e7ddf3] bg-[#f9f5ff] px-3 py-2 text-right sm:block">
                <div className="text-xs font-medium text-[#292545]">{user?.full_name}</div>
                <div className="text-[11px] text-[#6a6485]">{user?.email}</div>
                <div className="text-[11px] text-[#8f8aa7]">{user?.role}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.replace("/login");
                }}
                className="oa-btn-secondary px-3 py-1.5 text-sm font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}
