import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { inputController } from "./input";
import type { Preferences } from "@workspace/shared";
import { useCatalog } from "./catalog";
import { PendingAcknowledgements } from "./acknowledgements";
export interface TerminalRuntime {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  element: HTMLDivElement;
  sequence: number;
  paste(data: string): void;
  write(data: Uint8Array, acknowledge?: () => void): void;
  flushAcknowledgements(): void;
}
const runtimes = new Map<string, TerminalRuntime>();
export function terminalFor(id: string): TerminalRuntime {
  let runtime = runtimes.get(id);
  if (runtime) return runtime;
  const terminal = new Terminal({
    fontSize: 13,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: false,
    linkHandler: {
      activate: (_event, uri) => {
        try {
          const url = new URL(uri);
          if (["https:", "http:"].includes(url.protocol))
            window.open(url.href, "_blank", "noopener,noreferrer");
        } catch {
          /* Unsafe remote link is inert. */
        }
      },
    },
    theme: { background: "#17191d", foreground: "#d8e0e8", cursor: "#e4ecef" },
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.loadAddon(
    new WebLinksAddon((_event, uri) => {
      try {
        const url = new URL(uri);
        if (["https:", "http:"].includes(url.protocol))
          window.open(url.href, "_blank", "noopener,noreferrer");
      } catch {
        /* Invalid remote link is inert. */
      }
    }),
  );
  // Reject OSC 52 requests: remote applications cannot read or mutate the local clipboard.
  terminal.parser.registerOscHandler(52, () => true);
  const element = document.createElement("div");
  element.className = "terminal-host";
  terminal.open(element);
  const paste = (data: string) =>
    inputController.paste(id, data, (target, text) => {
      const normalized = text.replace(/\r?\n/g, "\r");
      return terminalFor(target).terminal.modes.bracketedPasteMode
        ? `\x1b[200~${normalized}\x1b[201~`
        : normalized;
    });
  element.addEventListener(
    "paste",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      paste(event.clipboardData?.getData("text/plain") ?? "");
    },
    true,
  );
  const pendingAcknowledgements = new PendingAcknowledgements();
  const write = (data: Uint8Array, acknowledge?: () => void) => {
    if (!acknowledge) {
      terminal.write(data);
      return;
    }
    const complete = pendingAcknowledgements.track(acknowledge);
    terminal.write(data, complete);
  };
  runtime = {
    terminal,
    fit,
    search,
    element,
    sequence: 0,
    paste,
    write,
    flushAcknowledgements: () => {
      pendingAcknowledgements.flush();
    },
  };
  runtimes.set(id, runtime);
  terminal.onData((data) => inputController.send(id, data));
  configureTerminal(
    id,
    useCatalog.getState().preferences.terminal,
    useCatalog.getState().preferences.appearance,
  );
  return runtime;
}
export function configureTerminal(
  id: string,
  options: Preferences["terminal"],
  appearance: Preferences["appearance"],
) {
  const runtime = runtimes.get(id);
  if (!runtime) return;
  runtime.terminal.options.scrollback = options.scrollback;
  runtime.terminal.options.fontSize = appearance.fontSize;
  runtime.terminal.options.cursorStyle = appearance.cursorStyle;
  runtime.terminal.options.theme =
    appearance.palette === "solarized-dark"
      ? {
          background: "#002b36",
          foreground: "#839496",
          cursor: "#93a1a1",
          selectionBackground: "#073642",
        }
      : { background: "#17191d", foreground: "#d8e0e8", cursor: "#e4ecef" };
}
export function disposeTerminal(id: string) {
  const runtime = runtimes.get(id);
  if (runtime) {
    // Closing a terminal must not strand socket acknowledgements behind xterm's parser queue.
    runtime.flushAcknowledgements();
    runtime.terminal.dispose();
    runtime.element.remove();
    runtimes.delete(id);
  }
}
export function disposeAllTerminals() {
  for (const id of runtimes.keys()) disposeTerminal(id);
}
