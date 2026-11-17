/**
 * Live WebSocket hook.
 *
 * The backend pushes a complete snapshot on connect and after every mutation,
 * so there is no polling and no diffing: each message simply replaces state.
 * Reconnects with exponential backoff if the socket drops.
 */

import { useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connecting" | "live" | "offline";

const HEARTBEAT_MS = 20_000;
const MAX_BACKOFF_MS = 10_000;

export function useLiveSocket<T>(
  url: string | null,
  onSnapshot: (snapshot: T) => void,
  onUnauthorized?: () => void,
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  // Keep the callback in a ref so a new closure never forces a reconnect.
  const handler = useRef(onSnapshot);
  handler.current = onSnapshot;
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  useEffect(() => {
    if (!url) {
      setStatus("offline");
      return;
    }

    let socket: WebSocket | null = null;
    let heartbeat: number | undefined;
    let retry: number | undefined;
    let attempt = 0;
    let disposed = false;

    const clearTimers = () => {
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (retry !== undefined) window.clearTimeout(retry);
      heartbeat = undefined;
      retry = undefined;
    };

    const open = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "offline");

      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
        heartbeat = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, HEARTBEAT_MS);
      };

      socket.onmessage = (event) => {
        try {
          handler.current(JSON.parse(event.data as string) as T);
        } catch {
          /* ignore malformed frames */
        }
      };

      socket.onerror = () => {
        /* onclose follows and handles the retry */
      };

      socket.onclose = event => {
        clearTimers();
        if (disposed) return;
        setStatus("offline");
        if (event.code === 4401) {
          disposed = true;
          unauthorized.current?.();
          return;
        }
        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        retry = window.setTimeout(open, delay);
      };
    };

    open();

    return () => {
      disposed = true;
      clearTimers();
      socket?.close();
    };
  }, [url]);

  return status;
}
