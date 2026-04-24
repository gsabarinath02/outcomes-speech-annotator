"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";

export default function HomePage() {
  const { accessToken, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (accessToken) {
      router.replace("/tasks");
      return;
    }
    router.replace("/login");
  }, [accessToken, isLoading, router]);

  return null;
}
