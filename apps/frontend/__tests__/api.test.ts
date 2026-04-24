import { describe, expect, it, vi } from "vitest";

import { APIError, fetchTasks, login } from "@/lib/api";
import { readSession, writeSession } from "@/lib/session";

describe("API client error handling", () => {
  it("wraps non-JSON error responses in APIError", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream unavailable", {
        status: 502,
        statusText: "Bad Gateway",
      })
    );

    await expect(login("admin@test.com", "password")).rejects.toMatchObject({
      name: "APIError",
      status: 502,
      message: "Bad Gateway",
    });

    fetchMock.mockRestore();
  });

  it("refreshes tokens and retries one authenticated request", async () => {
    writeSession("old-access", "old-refresh", {
      id: "user-1",
      email: "annotator@test.com",
      full_name: "Annotator",
      role: "ANNOTATOR",
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "bearer",
            user: {
              id: "user-1",
              email: "annotator@test.com",
              full_name: "Annotator",
              role: "ANNOTATOR",
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [], page: 1, page_size: 25, total: 0, status_counts: {} }),
          { status: 200 }
        )
      );

    await expect(fetchTasks("old-access", { page: 1 })).resolves.toMatchObject({ total: 0 });
    expect(readSession().accessToken).toBe("new-access");
    expect((fetchMock.mock.calls[2]?.[1]?.headers as Headers).get("Authorization")).toBe("Bearer new-access");

    fetchMock.mockRestore();
  });

  it("clears the session when refresh fails", async () => {
    writeSession("old-access", "bad-refresh", {
      id: "user-1",
      email: "annotator@test.com",
      full_name: "Annotator",
      role: "ANNOTATOR",
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "invalid refresh" }), { status: 401 }));

    await expect(fetchTasks("old-access", { page: 1 })).rejects.toMatchObject({ status: 401 });
    expect(readSession().accessToken).toBeNull();
    expect(readSession().refreshToken).toBeNull();

    fetchMock.mockRestore();
  });
});
