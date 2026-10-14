import { useState, type FormEvent, type ReactNode } from "react";
import {
  profileInputSchema,
  profileSchema,
  preferencesSchema,
  credentialInputSchema,
  type Profile,
  type Preferences,
  type CredentialDto,
} from "@workspace/shared";
import { api } from "../lib/api";
import { useCatalog } from "../lib/catalog";
import { useWorkspace } from "../lib/store";
import { currentOperation } from "../lib/operation";
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close(): void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        {children}
        <button
          className="dialog-close"
          aria-label={`Close ${title}`}
          onClick={close}
        >
          ×
        </button>
      </section>
    </div>
  );
}
export function ProfileEditor({
  profile,
  close,
  onSaved,
}: {
  profile?: Profile;
  close(): void;
  onSaved?(profile: Profile): Promise<void>;
}) {
  const catalog = useCatalog();
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null);
  const [name, setName] = useState(profile?.name ?? "");
  const [host, setHost] = useState(profile?.settings.host ?? "");
  const [port, setPort] = useState(profile?.settings.port ?? 22);
  const [username, setUsername] = useState(
    profile?.settings.username ?? useWorkspace.getState().user?.username ?? "",
  );
  const [policy, setPolicy] = useState(
    profile?.settings.hostKeyPolicy ?? "tofu",
  );
  const [folderId, setFolder] = useState(profile?.folderId ?? "");
  const [credentialId, setCredential] = useState(profile?.credentialId ?? "");
  const [terminal, setTerminal] = useState(
    profile?.settings.terminal ?? catalog.preferences.terminal,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const current = currentOperation();
    try {
      const body = profileInputSchema.parse({
        protocol: "ssh",
        name,
        settings: { host, port, username, hostKeyPolicy: policy, terminal },
        credentialId: credentialId || null,
        folderId: folderId || null,
      });
      const id = savedProfile?.id ?? profile?.id;
      const saved = await api(
        id ? `/profiles/${id}` : "/profiles",
        {
          method: id ? "PUT" : "POST",
          body,
        },
        profileSchema,
      );
      if (!current()) return;
      setSavedProfile(saved);
      await catalog.refresh();
      if (!current()) return;
      await onSaved?.(saved);
      if (!current()) return;
      close();
    } catch (error) {
      if (current()) setError(String(error));
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <Dialog
      title={profile?.id ? "Edit SSH profile" : "New SSH profile"}
      close={close}
    >
      <form onSubmit={submit}>
        <label>
          Profile name
          <input
            required
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Host
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="host or IPv6 address"
            />
          </label>
          <label>
            Port
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          SSH username
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Host key policy
          <select
            value={policy}
            onChange={(e) => setPolicy(e.target.value as typeof policy)}
          >
            <option value="tofu">TOFU — ask for unknown keys</option>
            <option value="strict">Strict — trusted keys only</option>
          </select>
        </label>
        <label>
          Saved credential
          <select
            value={credentialId}
            onChange={(e) => setCredential(e.target.value)}
          >
            <option value="">Session-only — ask on every connection</option>
            {catalog.credentials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.type})
              </option>
            ))}
          </select>
        </label>
        <label>
          Folder
          <select value={folderId} onChange={(e) => setFolder(e.target.value)}>
            <option value="">Root</option>
            {catalog.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <TerminalOptions value={terminal} change={setTerminal} />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save profile
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function TerminalOptions({
  value,
  change,
}: {
  value: Preferences["terminal"];
  change(value: Preferences["terminal"]): void;
}) {
  return (
    <details>
      <summary>Terminal options</summary>
      <label>
        Terminal type
        <select
          value={value.type}
          onChange={(e) =>
            change({ ...value, type: e.target.value as typeof value.type })
          }
        >
          <option>xterm-256color</option>
          <option>xterm</option>
          <option>vt100</option>
        </select>
      </label>
      <div className="form-grid">
        <label>
          Keepalive seconds
          <input
            type="number"
            min={5}
            max={300}
            value={value.keepaliveSeconds}
            onChange={(e) =>
              change({ ...value, keepaliveSeconds: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Scrollback lines
          <input
            type="number"
            min={100}
            max={50000}
            value={value.scrollback}
            onChange={(e) =>
              change({ ...value, scrollback: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Initial columns
          <input
            type="number"
            min={20}
            max={500}
            value={value.columns}
            onChange={(e) =>
              change({ ...value, columns: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Initial rows
          <input
            type="number"
            min={5}
            max={300}
            value={value.rows}
            onChange={(e) => change({ ...value, rows: Number(e.target.value) })}
          />
        </label>
      </div>
    </details>
  );
}
export function PreferencesDialog({ close }: { close(): void }) {
  const catalog = useCatalog();
  const [value, setValue] = useState(catalog.preferences);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Workspace preferences" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await catalog.savePreferences(preferencesSchema.parse(value));
            close();
          } catch (error) {
            setError(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Application theme
          <select
            value={value.theme}
            onChange={(e) =>
              setValue({
                ...value,
                theme: e.target.value as typeof value.theme,
              })
            }
          >
            <option value="classic-light">Classic Light</option>
            <option value="classic-dark">Classic Dark</option>
          </select>
        </label>
        <label>
          Terminal palette
          <select
            value={value.appearance.palette}
            onChange={(e) =>
              setValue({
                ...value,
                appearance: {
                  ...value.appearance,
                  palette: e.target.value as typeof value.appearance.palette,
                },
              })
            }
          >
            <option value="classic">Classic</option>
            <option value="solarized-dark">Solarized Dark</option>
          </select>
        </label>
        <div className="form-grid">
          <label>
            Terminal font size
            <input
              type="number"
              min={10}
              max={28}
              value={value.appearance.fontSize}
              onChange={(e) =>
                setValue({
                  ...value,
                  appearance: {
                    ...value.appearance,
                    fontSize: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Cursor style
            <select
              value={value.appearance.cursorStyle}
              onChange={(e) =>
                setValue({
                  ...value,
                  appearance: {
                    ...value.appearance,
                    cursorStyle: e.target
                      .value as typeof value.appearance.cursorStyle,
                  },
                })
              }
            >
              <option value="block">Block</option>
              <option value="underline">Underline</option>
              <option value="bar">Bar</option>
            </select>
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={value.sidebarVisible}
            onChange={(e) =>
              setValue({ ...value, sidebarVisible: e.target.checked })
            }
          />{" "}
          Show session sidebar
        </label>
        <TerminalOptions
          value={value.terminal}
          change={(terminal) => setValue({ ...value, terminal })}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save preferences
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function CredentialsDialog({ close }: { close(): void }) {
  const catalog = useCatalog();
  const [editing, setEditing] = useState<CredentialDto | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"password" | "key">("password");
  const [secret, setSecret] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function reset() {
    setEditing(null);
    setName("");
    setSecret("");
    setConsent(false);
  }
  return (
    <Dialog title="Saved credentials" close={close}>
      <p>
        Saving is optional. Saved secrets are encrypted on the server and cannot
        be displayed. Private-key passphrases are always requested for each new
        connection.
      </p>
      <div className="record-list">
        {catalog.credentials.map((item) => (
          <div key={item.id}>
            <span>
              {item.name} <small>({item.type})</small>
            </span>
            <button
              onClick={() => {
                reset();
                setEditing(item);
                setName(item.name);
                setType(item.type);
              }}
            >
              Replace
            </button>
            <button
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete credential “${item.name}”? Referencing profiles will need their saved credential removed or replaced before reconnecting.`,
                  )
                )
                  return;
                try {
                  await api(`/credentials/${item.id}`, { method: "DELETE" });
                  await catalog.refresh();
                  reset();
                } catch (error) {
                  setError(String(error));
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!consent) return;
          setBusy(true);
          const material =
            type === "password"
              ? { type, password: secret }
              : { type, privateKey: secret };
          setSecret("");
          setConsent(false);
          try {
            const body = credentialInputSchema.parse({ name, material });
            await api(editing ? `/credentials/${editing.id}` : "/credentials", {
              method: editing ? "PUT" : "POST",
              body,
            });
            await catalog.refresh();
            reset();
          } catch (error) {
            setError(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>{editing ? "Replace saved credential" : "Add saved credential"}</h3>
        <label>
          Credential name
          <input
            required
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Credential type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as typeof type);
              setSecret("");
            }}
          >
            <option value="password">Password</option>
            <option value="key">Private key</option>
          </select>
        </label>
        {type === "password" ? (
          <label>
            Saved password
            <input
              type="password"
              required
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        ) : (
          <label>
            OpenSSH private key
            <textarea
              required
              rows={7}
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          Save this secret encrypted on the server
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          {editing && (
            <button type="button" onClick={reset}>
              Cancel replacement
            </button>
          )}
          <button className="primary" disabled={!consent || busy}>
            Save credential
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function TrustDialog({ close }: { close(): void }) {
  const catalog = useCatalog();
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [publicKey, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Trusted host keys" close={close}>
      <p>
        Import verified public keys. A changed host key is always blocked;
        remove the old trust entry explicitly before accepting a replacement.
      </p>
      <div className="record-list">
        {catalog.trust.map((item) => (
          <div key={item.id}>
            <span>
              {item.host}:{item.port}
              <small className="fingerprint">
                {item.algorithm}
                <br />
                {item.fingerprint}
              </small>
            </span>
            <button
              onClick={async () => {
                if (
                  !window.confirm(
                    `Remove trust for ${item.host}:${item.port}? Verify its next key independently.`,
                  )
                )
                  return;
                try {
                  await api(`/host-keys/${item.id}`, { method: "DELETE" });
                  await catalog.refresh();
                } catch (error) {
                  setError(String(error));
                }
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/host-keys", {
              method: "POST",
              body: { host, port, publicKey },
            });
            await catalog.refresh();
            setKey("");
          } catch (error) {
            setError(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Host
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </label>
          <label>
            Port
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Verified public host key
          <textarea
            required
            rows={3}
            value={publicKey}
            onChange={(e) => setKey(e.target.value)}
            placeholder="ssh-ed25519 AAAA…"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button className="primary" disabled={busy}>
            Import trusted key
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
