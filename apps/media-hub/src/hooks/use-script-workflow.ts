import { useRef, useState } from "react";

/** Serialize user actions so double clicks cannot create competing version writes. */
export function useScriptWorkflow(setMessage: (message: string) => void) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (
    action: () => Promise<void>,
    fallback: string,
    { throwOnError = false }: { throwOnError?: boolean } = {},
  ) => {
    if (running.current) {
      if (throwOnError) throw new Error("当前操作尚未完成，请稍后重试。");
      return;
    }
    running.current = true;
    setPending(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
      if (throwOnError) throw error;
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return { run, pending };
}
