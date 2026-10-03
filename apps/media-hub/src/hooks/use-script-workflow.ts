import { useRef, useState } from "react";

/** Serialize user actions so double clicks cannot create competing version writes. */
export function useScriptWorkflow(setMessage: (message: string) => void) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (action: () => Promise<void>, fallback: string) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return { run, pending };
}
