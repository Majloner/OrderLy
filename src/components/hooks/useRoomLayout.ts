import { useCallback, useEffect, useState } from "react";
import type { RoomLayoutPayload } from "@/types";

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

// Thin client for /api/room/*: unwraps { data } and throws the PL { error }
// message from the API on failure. Mirrors callMenuApi (useMenu.ts).
export async function callRoomApi<T = unknown>(
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

export function useRoomLayout() {
  const [layout, setLayout] = useState<RoomLayoutPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Throws on failure so a mutation's follow-up refetch surfaces as an action
  // error (banner) instead of discarding the already-rendered layout.
  const refetch = useCallback(async () => {
    const data = await callRoomApi<RoomLayoutPayload>("GET", "/api/room");
    setLayout(data);
    setLoadError(null);
  }, []);

  // Retry path for the initial-load error panel (layout still null).
  const reload = useCallback(() => {
    setLoadError(null);
    callRoomApi<RoomLayoutPayload>("GET", "/api/room")
      .then(setLayout)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać schematu sali");
      });
  }, []);

  // Initial load; the cancelled flag guards against an unmount mid-flight.
  useEffect(() => {
    let cancelled = false;
    callRoomApi<RoomLayoutPayload>("GET", "/api/room")
      .then((data) => {
        if (!cancelled) {
          setLayout(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać schematu sali");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { layout, setLayout, loadError, refetch, reload };
}
