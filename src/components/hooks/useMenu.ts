import { useCallback, useEffect, useState } from "react";
import type { MenuPayload } from "@/types";

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

// Thin client for /api/menu/*: unwraps { data } and throws the PL { error }
// message from the API on failure.
export async function callMenuApi<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
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

export function useMenu() {
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Throws on failure so a mutation's follow-up refetch surfaces as an action
  // error (banner) instead of discarding the already-rendered menu.
  const refetch = useCallback(async () => {
    const data = await callMenuApi<MenuPayload>("GET", "/api/menu");
    setMenu(data);
    setLoadError(null);
  }, []);

  // Retry path for the initial-load error panel (menu still null).
  const reload = useCallback(() => {
    setLoadError(null);
    callMenuApi<MenuPayload>("GET", "/api/menu")
      .then(setMenu)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać menu");
      });
  }, []);

  // Initial load; setState happens in the promise callbacks (async), and the
  // cancelled flag guards against an unmount mid-flight.
  useEffect(() => {
    let cancelled = false;
    callMenuApi<MenuPayload>("GET", "/api/menu")
      .then((data) => {
        if (!cancelled) {
          setMenu(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać menu");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { menu, setMenu, loadError, refetch, reload };
}
