import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useWorkspace } from "../lib/store";
import { emit } from "../lib/transport";
import { useCatalog } from "../lib/catalog";
export function Prompts() {
  const host = useWorkspace((s) => s.hostRequests[0]);
  const auth = useWorkspace((s) => s.authRequests[0]);
  const [save, setSave] = useState(false);
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [type, setType] = useState<"password" | "key" | "passphrase">(
    "password",
  );
  useEffect(() => {
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
    setSave(false);
    setType(auth?.methods[0] ?? "password");
  }, [auth?.requestId, host?.requestId]);
  if (host)
    return (
      <div className="modal-backdrop">
        <section
          className="dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Verify SSH host key"
        >
          <h2>
            <ShieldCheck size={20} /> Verify SSH host key
          </h2>
          <p>
            Confirm this fingerprint through a trusted source before sending
            credentials.
          </p>
          <dl>
            <dt>Target</dt>
            <dd>
              {host.host}:{host.port}
            </dd>
            <dt>Algorithm</dt>
            <dd>{host.algorithm}</dd>
            <dt>Fingerprint</dt>
            <dd className="fingerprint">{host.fingerprint}</dd>
          </dl>
          <label>
            <input
              type="checkbox"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
            />{" "}
            Remember this host key
          </label>
          <footer>
            <button onClick={() => decide(false)}>Reject</button>
            <button className="primary" onClick={() => decide(true)}>
              Accept key
            </button>
          </footer>
        </section>
      </div>
    );
  async function decide(accept: boolean) {
    if (!host) return;
    try {
      await emit("hostkey:decision", {
        sessionId: host.sessionId,
        requestId: host.requestId,
        accept,
        save: accept && save,
      });
      useWorkspace.setState((s) => ({
        hostRequests: s.hostRequests.filter(
          (r) => r.requestId !== host.requestId,
        ),
      }));
      setSave(false);
      if (accept && save)
        void useCatalog
          .getState()
          .refresh()
          .catch((error) => useWorkspace.getState().setError(String(error)));
    } catch (error) {
      useWorkspace.getState().setError(String(error));
    }
  }
  if (!auth) return null;
  return (
    <div className="modal-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-label="SSH authentication"
        aria-modal="true"
        onSubmit={async (e) => {
          e.preventDefault();
          const credential =
            type === "password"
              ? { type, password }
              : type === "passphrase"
                ? { type, passphrase }
                : { type, privateKey, ...(passphrase ? { passphrase } : {}) };
          setPassword("");
          setPrivateKey("");
          setPassphrase("");
          try {
            await emit("auth:response", {
              sessionId: auth.sessionId,
              requestId: auth.requestId,
              credential,
            });
            useWorkspace.setState((s) => ({
              authRequests: s.authRequests.filter(
                (r) => r.requestId !== auth.requestId,
              ),
            }));
          } catch (error) {
            useWorkspace.getState().setError(String(error));
          }
        }}
      >
        <h2>SSH authentication</h2>
        <p>
          {useWorkspace
            .getState()
            .sessions.find((session) => session.id === auth.sessionId)?.name ??
            "Terminal"}
        </p>
        <p>Credentials remain session-only.</p>
        <label>
          Authentication
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {auth.methods.includes("password") && (
              <option value="password">Password</option>
            )}
            {auth.methods.includes("key") && (
              <option value="key">Private key</option>
            )}
            {auth.methods.includes("passphrase") && (
              <option value="passphrase">Saved key passphrase</option>
            )}
          </select>
        </label>
        {type === "password" ? (
          <label>
            Password
            <input
              autoFocus
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        ) : (
          <>
            {type === "key" && (
              <label>
                OpenSSH private key
                <textarea
                  rows={8}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                />
              </label>
            )}
            <label>
              Passphrase
              <input
                type="password"
                autoComplete="off"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
          </>
        )}
        <footer>
          <button
            type="button"
            onClick={() =>
              emit("session:close", { sessionId: auth.sessionId }).catch(
                (error) => useWorkspace.getState().setError(String(error)),
              )
            }
          >
            Cancel
          </button>
          <button className="primary">Authenticate</button>
        </footer>
      </form>
    </div>
  );
}
