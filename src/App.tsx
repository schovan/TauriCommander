import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FilePane, isRoot, splitExt, type Entry, type SortKey } from "./FilePane";
import { Settings } from "./Settings";
import { Lister } from "./Lister";
import { UpdateChecker } from "./UpdateChecker";
import "./App.css";

type Side = "left" | "right";
type Dialog = { type: "mkdir" } | { type: "delete"; items: Entry[] };

function sortEntries(entries: Entry[], key: SortKey, asc: boolean): Entry[] {
  const dir = asc ? 1 : -1;
  const byName = (a: Entry, b: Entry) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  const cmp = (a: Entry, b: Entry) => {
    let r = 0;
    if (key === "name") r = byName(a, b);
    else if (key === "ext")
      r = splitExt(a.name, a.is_dir).ext.toLowerCase().localeCompare(splitExt(b.name, b.is_dir).ext.toLowerCase());
    else if (key === "size") r = a.size - b.size;
    else if (key === "date") r = (a.modified ?? 0) - (b.modified ?? 0);
    if (r === 0) r = byName(a, b);
    return r * dir;
  };
  const dirs = entries.filter((e) => e.is_dir).sort(cmp);
  const files = entries.filter((e) => !e.is_dir).sort(cmp);
  return [...dirs, ...files];
}

function useSettings() {
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem("showHidden") === "1");
  const [editorPath, setEditorPath] = useState(() => localStorage.getItem("editorPath") ?? "");
  useEffect(() => {
    localStorage.setItem("showHidden", showHidden ? "1" : "0");
  }, [showHidden]);
  useEffect(() => {
    localStorage.setItem("editorPath", editorPath);
  }, [editorPath]);
  return { showHidden, setShowHidden, editorPath, setEditorPath };
}

function usePane(showHidden: boolean) {
  const [drive, setDrive] = useState("");
  const [path, setPath] = useState("");
  const [rawEntries, setRawEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const entries = useMemo(() => sortEntries(rawEntries, sortKey, sortAsc), [rawEntries, sortKey, sortAsc]);

  const load = useCallback(
    async (target: string, keepCursor = false) => {
      try {
        const result = await invoke<Entry[]>("read_dir", { path: target, showHidden });
        setRawEntries(result);
        setPath(target);
        setError(null);
        setMarked(new Set());
        setEditing(false);
        setCursor((c) => (keepCursor ? Math.min(c, result.length) : 0));
      } catch (e) {
        setError(String(e));
        setRawEntries([]);
        setPath(target);
      }
    },
    [showHidden],
  );

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((a) => !a);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return {
    drive, setDrive, path, setPath, entries,
    cursor, setCursor, marked, setMarked, error, setError,
    editing, setEditing, sortKey, sortAsc, toggleSort, load,
  };
}

type Pane = ReturnType<typeof usePane>;

function App() {
  const settings = useSettings();
  const { showHidden, editorPath } = settings;
  const [drives, setDrives] = useState<string[]>([]);
  const [activeSide, setActiveSide] = useState<Side>("left");
  const [view, setView] = useState<"files" | "settings">("files");
  const [showUpdates, setShowUpdates] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [lister, setLister] = useState<{ name: string; content: string } | null>(null);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("cmdHistory") ?? "[]");
    } catch {
      return [];
    }
  });
  const [histIdx, setHistIdx] = useState(-1);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);
  const left = usePane(showHidden);
  const right = usePane(showHidden);
  const inited = useRef(false);

  useEffect(() => {
    invoke<string[]>("list_drives").then(setDrives).catch(() => setDrives([]));
  }, []);

  useEffect(() => {
    if (drives.length && !inited.current) {
      inited.current = true;
      left.setDrive(drives[0]);
      left.load(drives[0]);
      right.setDrive(drives[0]);
      right.load(drives[0]);
    }
  }, [drives, left, right]);

  // Re-read both panes when the hidden-files setting changes.
  useEffect(() => {
    if (inited.current) {
      left.load(left.path, true);
      right.load(right.path, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  const paneFor = (side: Side) => (side === "left" ? left : right);
  const active = paneFor(activeSide);
  const other = paneFor(activeSide === "left" ? "right" : "left");

  const hasUp = (pane: Pane) => !isRoot(pane.path);
  const rowToEntry = (pane: Pane, row: number): Entry | null => {
    const off = hasUp(pane) ? 1 : 0;
    if (hasUp(pane) && row === 0) return null;
    return pane.entries[row - off] ?? null;
  };
  const maxRow = (pane: Pane) => pane.entries.length + (hasUp(pane) ? 1 : 0) - 1;

  const targetsOf = (pane: Pane): Entry[] => {
    if (pane.marked.size > 0) return pane.entries.filter((e) => pane.marked.has(e.path));
    const e = rowToEntry(pane, pane.cursor);
    return e ? [e] : [];
  };

  const goUp = async (side: Side) => {
    const pane = paneFor(side);
    const parent = await invoke<string | null>("parent_dir", { path: pane.path });
    if (parent) pane.load(parent);
  };

  const openRow = async (side: Side, row: number) => {
    const pane = paneFor(side);
    if (hasUp(pane) && row === 0) return goUp(side);
    const e = rowToEntry(pane, row);
    if (!e) return;
    if (e.is_dir) pane.load(e.path);
    else await invoke("open_path", { path: e.path }).catch((err) => pane.setError(String(err)));
  };

  const viewFile = async () => {
    const e = rowToEntry(active, active.cursor);
    if (!e || e.is_dir) return;
    try {
      const content = await invoke<string>("read_file_preview", { path: e.path });
      setLister({ name: e.name, content });
    } catch (err) {
      active.setError(String(err));
    }
  };

  const editFile = async () => {
    const e = rowToEntry(active, active.cursor);
    if (!e || e.is_dir) return;
    await invoke("edit_file", { path: e.path, editor: editorPath || null }).catch((err) =>
      active.setError(String(err)),
    );
  };

  const doTransfer = async (move: boolean) => {
    const items = targetsOf(active);
    if (!items.length) return;
    try {
      await invoke(move ? "move_entries" : "copy_entries", {
        sources: items.map((i) => i.path),
        dest: other.path,
      });
      await active.load(active.path, true);
      await other.load(other.path, true);
    } catch (e) {
      active.setError(String(e));
    }
  };

  const askDelete = () => {
    const items = targetsOf(active);
    if (items.length) setDialog({ type: "delete", items });
  };

  const doDelete = async (items: Entry[]) => {
    setDialog(null);
    try {
      await invoke("delete_entries", { paths: items.map((i) => i.path) });
      await active.load(active.path, true);
    } catch (e) {
      active.setError(String(e));
    }
  };

  const doMkdir = async (name: string) => {
    setDialog(null);
    if (!name.trim()) return;
    try {
      await invoke("create_dir", { parent: active.path, name: name.trim() });
      await active.load(active.path, true);
    } catch (e) {
      active.setError(String(e));
    }
  };

  const onContext = (side: Side, row: number) => {
    setActiveSide(side);
    const pane = paneFor(side);
    const e = rowToEntry(pane, row);
    if (!e) return;
    pane.setMarked((m) => {
      const n = new Set(m);
      if (n.has(e.path)) n.delete(e.path);
      else n.add(e.path);
      return n;
    });
  };

  const exitApp = () => {
    getCurrentWindow().close();
  };

  const pushHistory = (c: string) => {
    setHistory((h) => {
      const next = [c, ...h.filter((x) => x !== c)].slice(0, 30);
      localStorage.setItem("cmdHistory", JSON.stringify(next));
      return next;
    });
  };

  const runCmd = async () => {
    const c = cmd.trim();
    if (!c) return;
    pushHistory(c);
    setHistIdx(-1);
    // TC-style "cd" navigates the active pane instead of spawning a shell.
    if (c === "cd.." || c === "cd ..") {
      goUp(activeSide);
      setCmd("");
      return;
    }
    if (/^cd\s+/i.test(c)) {
      const t = c.replace(/^cd\s+/i, "").trim().replace(/^"|"$/g, "");
      const abs = /^[A-Za-z]:[\\/]/.test(t) || t.startsWith("/") || t.startsWith("\\");
      const dest = abs ? t : `${active.path.replace(/[\\/]+$/, "")}\\${t}`;
      await active.load(dest);
      setCmd("");
      return;
    }
    try {
      await invoke("run_command", { command: c, cwd: active.path });
    } catch (e) {
      setAlert({ title: "Command failed", message: String(e) });
    }
    setCmd("");
  };

  const ks = useRef<any>(null);
  ks.current = {
    activeSide, active, dialog, showUpdates, lister, view, alert,
    setActiveSide, setDialog, setLister, setAlert, goUp, openRow, viewFile, editFile, doTransfer, askDelete, exitApp,
    hasUp, maxRow,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = ks.current;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" && s.lister) {
        e.preventDefault();
        s.setLister(null);
        return;
      }
      if (e.key === "Escape" && s.alert) {
        e.preventDefault();
        s.setAlert(null);
        return;
      }
      if (s.dialog || s.showUpdates || s.lister || s.alert || s.view !== "files") return;
      const pane = s.active;
      switch (e.key) {
        case "Tab":
          e.preventDefault();
          s.setActiveSide(s.activeSide === "left" ? "right" : "left");
          break;
        case "ArrowDown":
          e.preventDefault();
          pane.setCursor((c: number) => Math.min(c + 1, s.maxRow(pane)));
          break;
        case "ArrowUp":
          e.preventDefault();
          pane.setCursor((c: number) => Math.max(c - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          s.openRow(s.activeSide, pane.cursor);
          break;
        case "Backspace":
          e.preventDefault();
          s.goUp(s.activeSide);
          break;
        case "F3":
          e.preventDefault();
          s.viewFile();
          break;
        case "F4":
          e.preventDefault();
          s.editFile();
          break;
        case "F5":
          e.preventDefault();
          s.doTransfer(false);
          break;
        case "F6":
          e.preventDefault();
          s.doTransfer(true);
          break;
        case "F7":
          e.preventDefault();
          s.setDialog({ type: "mkdir" });
          break;
        case "F8":
        case "Delete":
          e.preventDefault();
          s.askDelete();
          break;
        case "F10":
          e.preventDefault();
          s.exitApp();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const renderPane = (side: Side) => {
    const pane = paneFor(side);
    return (
      <FilePane
        active={activeSide === side}
        drives={drives}
        drive={pane.drive}
        path={pane.path}
        entries={pane.entries}
        cursor={pane.cursor}
        marked={pane.marked}
        error={pane.error}
        editing={pane.editing}
        sortKey={pane.sortKey}
        sortAsc={pane.sortAsc}
        onSort={pane.toggleSort}
        onActivate={() => setActiveSide(side)}
        onDriveChange={(d) => {
          setActiveSide(side);
          pane.setDrive(d);
          pane.load(d);
        }}
        onRowClick={(row) => {
          setActiveSide(side);
          pane.setCursor(row);
        }}
        onRowContext={(row) => onContext(side, row)}
        onRowOpen={(row) => openRow(side, row)}
        onUp={() => goUp(side)}
        onPathEditStart={() => {
          setActiveSide(side);
          pane.setEditing(true);
        }}
        onPathSubmit={(v) => pane.load(v)}
        onPathCancel={() => pane.setEditing(false)}
      />
    );
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Total Commander</h1>
        <div className="app-header-actions">
          <button type="button" onClick={() => setView(view === "files" ? "settings" : "files")}>
            {view === "files" ? "⚙ Settings" : "← Files"}
          </button>
          <button type="button" onClick={() => setShowUpdates(true)}>
            Check for updates
          </button>
        </div>
      </header>

      {view === "settings" ? (
        <Settings {...settings} onBack={() => setView("files")} />
      ) : (
        <>
          <div className="panes">
            {drives.length > 0 && (
              <>
                {renderPane("left")}
                {renderPane("right")}
              </>
            )}
          </div>

          <form
            className="cmdline"
            onSubmit={(e) => {
              e.preventDefault();
              runCmd();
            }}
          >
            <span className="cmdline-prefix">{active.path}&gt;</span>
            <input
              className="cmdline-input"
              list="cmd-history"
              value={cmd}
              onChange={(e) => {
                setCmd(e.target.value);
                setHistIdx(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (history.length) {
                    const i = Math.min(histIdx + 1, history.length - 1);
                    setHistIdx(i);
                    setCmd(history[i]);
                  }
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const i = histIdx - 1;
                  if (i < 0) {
                    setHistIdx(-1);
                    setCmd("");
                  } else {
                    setHistIdx(i);
                    setCmd(history[i]);
                  }
                }
              }}
              placeholder="Type a command and press Enter…"
              spellCheck={false}
            />
            <datalist id="cmd-history">
              {history.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </form>

          <div className="fnbar">
            <button type="button" onClick={viewFile}>F3 View</button>
            <button type="button" onClick={editFile}>F4 Edit</button>
            <button type="button" onClick={() => doTransfer(false)}>F5 Copy</button>
            <button type="button" onClick={() => doTransfer(true)}>F6 Move</button>
            <button type="button" onClick={() => setDialog({ type: "mkdir" })}>F7 NewFolder</button>
            <button type="button" onClick={askDelete}>F8 Delete</button>
            <button type="button" onClick={exitApp}>F10 Exit</button>
          </div>
        </>
      )}

      {dialog?.type === "mkdir" && (
        <MkdirDialog onSubmit={doMkdir} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          count={dialog.items.length}
          onConfirm={() => doDelete(dialog.items)}
          onCancel={() => setDialog(null)}
        />
      )}

      {lister && (
        <Lister name={lister.name} content={lister.content} onClose={() => setLister(null)} />
      )}

      {alert && (
        <MessageDialog title={alert.title} message={alert.message} onClose={() => setAlert(null)} />
      )}

      {showUpdates && <UpdateChecker onClose={() => setShowUpdates(false)} />}
    </div>
  );
}

function MkdirDialog({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="update-overlay" onClick={onCancel}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-header">
          <h3>New folder</h3>
        </div>
        <div className="update-body">
          <input
            ref={ref}
            className="dialog-input"
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit((e.target as HTMLInputElement).value);
              else if (e.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="update-footer">
          <button type="button" className="update-primary" onClick={() => onSubmit(ref.current?.value ?? "")}>
            Create
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="update-overlay" onClick={onCancel}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-header">
          <h3>Delete</h3>
        </div>
        <div className="update-body">
          <p className="update-strong">
            Delete {count} item{count === 1 ? "" : "s"}?
          </p>
          <p className="update-muted">This cannot be undone.</p>
        </div>
        <div className="update-footer">
          <button type="button" className="update-primary" onClick={onConfirm}>
            Delete
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="update-overlay" onClick={onClose}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-header">
          <h3>{title}</h3>
          <button type="button" className="update-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="update-body">
          <p className="update-muted">{message}</p>
        </div>
        <div className="update-footer">
          <button type="button" className="update-primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
