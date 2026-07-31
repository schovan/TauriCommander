import { useState, useEffect, useCallback, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

type UpdateState =
  | { type: "checking" }
  | { type: "available"; version: string; notes: string | null; install: () => Promise<void> }
  | { type: "downloading"; progress: number }
  | { type: "done" }
  | { type: "uptodate" }
  | { type: "error"; message: string };

interface Props {
  onClose: () => void;
  /** "background" closes silently when no update is found; "manual" always shows a result. */
  mode?: "background" | "manual";
}

export function UpdateChecker({ onClose, mode = "manual" }: Props) {
  const [state, setState] = useState<UpdateState>({ type: "checking" });
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const doCheck = useCallback(async () => {
    setState({ type: "checking" });
    try {
      const update = await check();
      if (update) {
        setState({
          type: "available",
          version: update.version,
          notes: update.body ?? null,
          install: async () => {
            setState({ type: "downloading", progress: 0 });
            try {
              let downloaded = 0;
              let contentLength = 0;
              await update.downloadAndInstall((event) => {
                if (event.event === "Started") {
                  contentLength = event.data.contentLength ?? 0;
                } else if (event.event === "Progress") {
                  downloaded += event.data.chunkLength;
                  const progress = contentLength > 0 ? downloaded / contentLength : 0;
                  setState({ type: "downloading", progress });
                }
              });
              setState({ type: "done" });
            } catch (e) {
              setState({ type: "error", message: String(e) });
            }
          },
        });
      } else if (mode === "background") {
        onCloseRef.current();
      } else {
        setState({ type: "uptodate" });
      }
    } catch (e) {
      if (mode === "background") {
        onCloseRef.current();
        return;
      }
      setState({ type: "error", message: String(e) });
    }
  }, [mode]);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion(null));
  }, []);

  useEffect(() => {
    doCheck();
  }, [doCheck]);

  return (
    <div className="update-overlay" onClick={onClose}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-header">
          <h3>Software Update</h3>
          <button type="button" className="update-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="update-body">
          {state.type === "checking" && <p>Checking for updates…</p>}

          {state.type === "uptodate" && (
            <>
              <p className="update-strong">You're up to date</p>
              <p className="update-muted">Version {currentVersion ?? "?"} is the latest.</p>
            </>
          )}

          {state.type === "available" && (
            <>
              <p className="update-strong">Version {state.version} is available</p>
              <p className="update-muted">Do you want to download and install it now?</p>
              {state.notes && <pre className="update-notes">{state.notes}</pre>}
              <button type="button" className="update-primary" onClick={state.install}>
                Install update
              </button>
            </>
          )}

          {state.type === "downloading" && (
            <>
              <p className="update-strong">Downloading update…</p>
              <p className="update-muted">{Math.round(state.progress * 100)}% complete</p>
              <div className="update-progress">
                <div className="update-progress-bar" style={{ width: `${Math.round(state.progress * 100)}%` }} />
              </div>
            </>
          )}

          {state.type === "done" && (
            <>
              <p className="update-strong">Update downloaded</p>
              <p className="update-muted">Restart the app to apply the update.</p>
            </>
          )}

          {state.type === "error" && (
            <>
              <p className="update-strong">Update check failed</p>
              <p className="update-muted">{state.message}</p>
              <button type="button" className="update-primary" onClick={doCheck}>
                Try again
              </button>
            </>
          )}
        </div>

        <div className="update-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
