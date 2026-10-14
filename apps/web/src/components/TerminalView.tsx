import { useEffect, useRef } from "react";
import { terminalFor, configureTerminal } from "../lib/terminals";
import type { Preferences } from "@workspace/shared";
import { emit } from "../lib/transport";
export function TerminalView({
  sessionId,
  terminalOptions,
  appearance,
  resize = true,
  active = true,
}: {
  sessionId: string;
  terminalOptions: Preferences["terminal"];
  appearance: Preferences["appearance"];
  resize?: boolean;
  active?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const runtime = terminalFor(sessionId);
    const element = container.current!;
    element.append(runtime.element);
    const fit = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      runtime.fit.fit();
      if (resize)
        emit("terminal:resize", {
          sessionId,
          columns: runtime.terminal.cols,
          rows: runtime.terminal.rows,
        }).catch(() => {});
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    const timer = window.setTimeout(fit, 0);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      runtime.element.remove();
    };
  }, [sessionId, resize]);
  useEffect(() => {
    configureTerminal(sessionId, terminalOptions, appearance);
    const runtime = terminalFor(sessionId);
    const timer = window.setTimeout(() => {
      if (!container.current?.clientWidth || !container.current?.clientHeight)
        return;
      runtime.fit.fit();
      if (resize)
        emit("terminal:resize", {
          sessionId,
          columns: runtime.terminal.cols,
          rows: runtime.terminal.rows,
        }).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionId, terminalOptions, appearance, resize]);
  useEffect(() => {
    if (active && !document.querySelector('[role="dialog"]'))
      terminalFor(sessionId).terminal.focus();
  }, [active, sessionId]);
  return <div className="terminal-container" ref={container} />;
}
