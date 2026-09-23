import { useEffect } from "react";
import type { DaemonCommand, DaemonEvent } from "../protocol";

export type DaemonClientHandlers = {
  onConnectionChange: (connected: boolean) => void;
  onEvent: (event: DaemonEvent) => void;
};

export function useDaemonClient({ onConnectionChange, onEvent }: DaemonClientHandlers) {
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    events.onerror = () => onConnectionChange(false);
    events.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as DaemonEvent);
      } catch {
        // A future daemon event must not take down the rest of the interface.
      }
    };

    return () => events.close();
  }, [onConnectionChange, onEvent]);
}

export async function sendDaemonCommand(command: DaemonCommand) {
  const response = await fetch("/api/v1/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`command failed: ${response.status}`);
}
