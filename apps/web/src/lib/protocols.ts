import { sshCapabilities, type SessionDto } from "@workspace/shared";
export const protocolDescriptors = {
  ssh: { label: "SSH", capabilities: sshCapabilities },
};
export function terminalActions(session: SessionDto) {
  return {
    terminal:
      protocolDescriptors[session.protocol].capabilities.terminal &&
      session.capabilities.terminal,
    resize: session.capabilities.resize,
  };
}
/** Register only real tools; each tool declares the capabilities it needs. */
export const workspaceTools = [
  { id: "clipboard", label: "Clipboard", requires: ["terminal"] },
  { id: "search", label: "Scrollback search", requires: ["terminal"] },
] as const;
export function availableWorkspaceTools(session: SessionDto) {
  const descriptor = protocolDescriptors[session.protocol];
  return workspaceTools.filter((tool) =>
    tool.requires.every(
      (capability) =>
        descriptor.capabilities[capability] && session.capabilities[capability],
    ),
  );
}
