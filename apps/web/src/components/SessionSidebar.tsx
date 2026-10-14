import { useState } from "react";
import {
  FolderClosed,
  ChevronRight,
  ChevronDown,
  Terminal,
  Pencil,
  Trash2,
  Plus,
  Play,
  Shield,
  Layers,
} from "lucide-react";
import {
  folderSchema,
  groupLaunchSchema,
  type Profile,
  type Folder,
} from "@workspace/shared";
import { useWorkspace } from "../lib/store";
import { useCatalog } from "../lib/catalog";
import { api } from "../lib/api";
import { attach } from "../lib/transport";
import { currentOperation } from "../lib/operation";
import { restoreWorkspace } from "../lib/workspaces";
import { Dialog } from "./ConfigurationDialogs";
export function SessionSidebar({
  editProfile,
  connectProfile,
  openWorkspaces,
}: {
  editProfile(profile?: Profile): void;
  connectProfile(profile: Profile): Promise<void>;
  openWorkspaces(): void;
}) {
  const state = useWorkspace();
  const catalog = useCatalog();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [launching, setLaunching] = useState(false);
  const report = (error: unknown) => state.setError(String(error));
  const [folderForm, setFolderForm] = useState<{
    folder?: Folder;
    name: string;
    parentId: string | null;
  } | null>(null);
  function folderEdit(folder?: Folder, parentId: string | null = null) {
    setFolderForm({
      folder,
      name: folder?.name ?? "",
      parentId: folder?.parentId ?? parentId,
    });
  }
  const forbiddenParents = new Set<string>();
  if (folderForm?.folder) {
    forbiddenParents.add(folderForm.folder.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of catalog.folders)
        if (
          folder.parentId &&
          forbiddenParents.has(folder.parentId) &&
          !forbiddenParents.has(folder.id)
        ) {
          forbiddenParents.add(folder.id);
          changed = true;
        }
    }
  }
  async function launch(id: string) {
    setLaunching(true);
    const current = currentOperation();
    try {
      const response = await api(
        `/folders/${id}/launch`,
        { method: "POST" },
        groupLaunchSchema,
      );
      if (!current()) return;
      const errors: string[] = [];
      for (const entry of response.entries) {
        if (!current()) return;
        if (entry.session) {
          state.upsert(entry.session);
          try {
            await attach(entry.session.id);
          } catch (error) {
            errors.push(String(error));
          }
        } else if (entry.error) errors.push(entry.error.message);
      }
      if (current() && errors.length) state.setError(errors.join("; "));
    } catch (error) {
      if (current()) report(error);
    } finally {
      setLaunching(false);
    }
  }
  function profiles(folderId: string | null) {
    return catalog.profiles
      .filter((profile) => profile.folderId === folderId)
      .map((profile) => (
        <div className="profile-row" key={profile.id}>
          <button
            className="tree-session"
            disabled={!state.online}
            title={`${profile.settings.username}@${profile.settings.host}:${profile.settings.port}`}
            onClick={() => connectProfile(profile).catch(report)}
          >
            <Terminal size={13} />
            <span>{profile.name}</span>
          </button>
          <button
            className="icon-button"
            aria-label={`Edit profile ${profile.name}`}
            onClick={() => editProfile(profile)}
          >
            <Pencil size={12} />
          </button>
          <button
            className="icon-button"
            aria-label={`Delete profile ${profile.name}`}
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete profile “${profile.name}”? Live sessions are kept.`,
                )
              )
                return;
              try {
                await api(`/profiles/${profile.id}`, { method: "DELETE" });
                await catalog.refresh();
              } catch (error) {
                report(error);
              }
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ));
  }
  function folders(
    parentId: string | null,
    ancestors: string[] = [],
  ): React.ReactNode {
    return catalog.folders
      .filter(
        (folder) =>
          folder.parentId === parentId && !ancestors.includes(folder.id),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((folder) => (
        <div className="folder-node" key={folder.id}>
          <div className="folder-row">
            <button
              className="folder-label"
              aria-expanded={!collapsed.includes(folder.id)}
              onClick={() =>
                setCollapsed((ids) =>
                  ids.includes(folder.id)
                    ? ids.filter((id) => id !== folder.id)
                    : [...ids, folder.id],
                )
              }
            >
              {collapsed.includes(folder.id) ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              <FolderClosed size={14} />
              <span>{folder.name}</span>
            </button>
            <button
              className="icon-button"
              aria-label={`Launch group ${folder.name}`}
              disabled={!state.online || launching}
              onClick={() => void launch(folder.id)}
            >
              <Play size={12} />
            </button>
            <button
              className="icon-button"
              aria-label={`Add folder in ${folder.name}`}
              onClick={() => void folderEdit(undefined, folder.id)}
            >
              <Plus size={12} />
            </button>
            <button
              className="icon-button"
              aria-label={`Edit folder ${folder.name}`}
              onClick={() => void folderEdit(folder)}
            >
              <Pencil size={12} />
            </button>
            <button
              className="icon-button"
              aria-label={`Delete folder ${folder.name}`}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete folder “${folder.name}”? Its direct profiles and child folders will move to root.`,
                  )
                )
                  return;
                try {
                  await api(`/folders/${folder.id}`, { method: "DELETE" });
                  await catalog.refresh();
                } catch (error) {
                  report(error);
                }
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
          {!collapsed.includes(folder.id) && (
            <div className="folder-children">
              {folders(folder.id, [...ancestors, folder.id])}
              {profiles(folder.id)}
            </div>
          )}
        </div>
      ));
  }
  return (
    <>
      <div className="sidebar-title">Sessions</div>
      <div className="tree-heading">
        <FolderClosed size={15} /> Saved profiles
        <span className="spacer" />
        <button
          className="icon-button"
          aria-label="New folder"
          onClick={() => void folderEdit()}
        >
          <Plus size={14} />
        </button>
      </div>
      {folders(null)}
      {profiles(null)}
      {!catalog.profiles.length && (
        <p className="sidebar-note">
          Save a profile with + Session, or connect directly above.
        </p>
      )}
      <div className="tree-heading">
        <Layers size={15} /> Workspaces
        <span className="spacer" />
        <button
          className="icon-button"
          aria-label="Manage workspaces"
          onClick={openWorkspaces}
        >
          <Plus size={14} />
        </button>
      </div>
      {catalog.workspaces.map((workspace) => (
        <button
          key={workspace.id}
          className="tree-session"
          disabled={!state.online}
          onClick={() => restoreWorkspace(workspace).catch(report)}
        >
          <Layers size={13} />
          <span>{workspace.name}</span>
        </button>
      ))}
      <div className="tree-heading">
        <FolderClosed size={15} /> Live sessions
      </div>
      {state.sessions.map((session) => (
        <button
          key={session.id}
          className={`tree-session ${session.id === state.activeId ? "selected" : ""}`}
          onClick={() => state.setActive(session.id)}
        >
          <span className={`state-dot ${session.state.toLowerCase()}`} />
          <span>{session.name}</span>
        </button>
      ))}
      {folderForm && (
        <Dialog
          title={folderForm.folder ? "Edit folder" : "New folder"}
          close={() => setFolderForm(null)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api(
                  folderForm.folder
                    ? `/folders/${folderForm.folder.id}`
                    : "/folders",
                  {
                    method: folderForm.folder ? "PUT" : "POST",
                    body: {
                      name: folderForm.name,
                      parentId: folderForm.parentId,
                      sortOrder: folderForm.folder?.sortOrder ?? 0,
                    },
                  },
                  folderSchema,
                );
                await catalog.refresh();
                setFolderForm(null);
              } catch (error) {
                report(error);
              }
            }}
          >
            <label>
              Folder name
              <input
                required
                maxLength={128}
                value={folderForm.name}
                onChange={(event) =>
                  setFolderForm({ ...folderForm, name: event.target.value })
                }
              />
            </label>
            <label>
              Parent folder
              <select
                value={folderForm.parentId ?? ""}
                onChange={(event) =>
                  setFolderForm({
                    ...folderForm,
                    parentId: event.target.value || null,
                  })
                }
              >
                <option value="">Root</option>
                {catalog.folders
                  .filter((folder) => !forbiddenParents.has(folder.id))
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
              </select>
            </label>
            <footer>
              <button type="button" onClick={() => setFolderForm(null)}>
                Cancel
              </button>
              <button className="primary">Save folder</button>
            </footer>
          </form>
        </Dialog>
      )}
      <p className="sidebar-note">
        <Shield size={14} /> All targets must match your administrator’s network
        policy.
      </p>
    </>
  );
}
