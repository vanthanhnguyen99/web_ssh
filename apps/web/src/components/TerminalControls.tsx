import { useState } from "react";
import type { SessionDto } from "@workspace/shared";
import { terminalFor } from "../lib/terminals";
import { useWorkspace } from "../lib/store";
import { availableWorkspaceTools } from "../lib/protocols";
export function TerminalControls({ session }: { session: SessionDto }) {
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState(false);
  const online = useWorkspace((s) => s.online);
  const runtime = () => terminalFor(session.id);
  const tools = availableWorkspaceTools(session);
  return (
    <div className="terminal-controls">
      {tools.some((tool) => tool.id === "clipboard") && (
        <>
          <button
            title="Copy selected terminal text"
            onClick={async () => {
              try {
                const value = runtime().terminal.getSelection();
                if (!value)
                  throw new Error("Select terminal text to copy first");
                await navigator.clipboard.writeText(value);
              } catch (error) {
                useWorkspace.getState().setError(String(error));
              }
            }}
          >
            Copy
          </button>
          <button
            disabled={!online || session.state !== "OPEN"}
            onClick={async () => {
              try {
                runtime().paste(await navigator.clipboard.readText());
              } catch (error) {
                useWorkspace
                  .getState()
                  .setError(
                    `Clipboard unavailable; use your browser paste shortcut. ${String(error)}`,
                  );
              }
            }}
          >
            Paste
          </button>
        </>
      )}
      {tools.some((tool) => tool.id === "search") && (
        <>
          <label
            className="terminal-search-label"
            htmlFor={`search-${session.id}`}
          >
            Find
          </label>
          <input
            id={`search-${session.id}`}
            aria-label="Search terminal"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMissing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setMissing(!runtime().search.findNext(query));
              }
            }}
            placeholder="Search scrollback"
          />
          <button
            disabled={!query}
            onClick={() => setMissing(!runtime().search.findPrevious(query))}
          >
            Previous
          </button>
          <button
            disabled={!query}
            onClick={() => setMissing(!runtime().search.findNext(query))}
          >
            Next
          </button>
          {missing && <span role="status">No match</span>}
        </>
      )}
    </div>
  );
}
