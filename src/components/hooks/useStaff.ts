import { useCallback, useEffect, useState } from "react";
import type { StaffMember } from "@/types";

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

// Thin client for /api/staff/*: unwraps { data } and throws the PL { error }
// message from the API on failure. Mirrors callMenuApi.
export async function callStaffApi<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok) {
    throw new Error(envelope?.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
  }

  return envelope?.data as T;
}

export function useStaff() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Throws on failure so a mutation's follow-up refetch surfaces as an action
  // error (banner) instead of discarding the already-rendered list.
  const refetch = useCallback(async () => {
    const data = await callStaffApi<StaffMember[]>("GET", "/api/staff");
    setStaff(data);
    setLoadError(null);
  }, []);

  // Retry path for the initial-load error panel (staff still null).
  const reload = useCallback(() => {
    setLoadError(null);
    callStaffApi<StaffMember[]>("GET", "/api/staff")
      .then(setStaff)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać listy personelu");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    callStaffApi<StaffMember[]>("GET", "/api/staff")
      .then((data) => {
        if (!cancelled) {
          setStaff(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać listy personelu");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { staff, setStaff, loadError, refetch, reload };
}
