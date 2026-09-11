import { useCallback, useEffect, useState } from "react";
import type { MenuPayload } from "@/types";

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

// Thin client for /api/menu/*: unwraps { data } and throws the PL { error }
// message from the API on failure.
export async function callMenuApi<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
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

interface UseMenuOptions {
  // Poll interval in ms; 0/undefined disables polling. FR-007's "real time" is
  // deliberately degraded to a 3-5 s poll (tech-stack.md) — S-05 uses 4000.
  pollMs?: number;
  // The consumer pauses ticks while a dialog is open or a mutation is in
  // flight, so a background refetch never clobbers an optimistic update or
  // rebuilds the tree under an open form.
  pollPaused?: boolean;
}

export function useMenu(options?: UseMenuOptions) {
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollMs = options?.pollMs ?? 0;
  const pollPaused = options?.pollPaused ?? false;

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

  // The repo's first polling loop (S-05, FR-007). Three guards per tick:
  // pollPaused (dialog open / mutation in flight — from the consumer),
  // document.hidden (a hidden tab must not generate traffic; checked per tick
  // rather than via visibilitychange — returning to the tab simply resumes on
  // the next interval), and inFlight (a slow response must not stack requests).
  // A tick failure is SILENT: menu is already on screen, and a transient
  // network blip flashing the error banner every 4 s would be worse than a
  // briefly stale list. The initial-load path above still surfaces loadError.
  useEffect(() => {
    if (pollMs <= 0) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const tick = () => {
      if (cancelled || inFlight || pollPaused || document.hidden) {
        return;
      }
      inFlight = true;
      callMenuApi<MenuPayload>("GET", "/api/menu")
        .then((data) => {
          if (!cancelled) {
            setMenu(data);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    const id = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs, pollPaused]);

  return { menu, setMenu, loadError, refetch, reload };
}
