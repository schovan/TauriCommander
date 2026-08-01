import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FilePane, isRoot, splitExt, type Entry, type PaneTab, type SortKey } from "./FilePane";
import { Settings } from "./Settings";
import { Lister } from "./Lister";
import { UpdateChecker } from "./UpdateChecker";
import "./App.css";

type Side = "left" | "right";
type Dialog =
  | { type: "mkdir" }
  | { type: "delete"; items: Entry[] }
  | { type: "select" }
  | { type: "deselect" };
type PaneState = {
  sortKey?: SortKey;
  sortAsc?: boolean;
  tabs?: PaneTab[];
  activeTab?: number;
};

type TabContextMenu = {
  side: Side;
  index: number;
  x: number;
  y: number;
};

const sortKeys: SortKey[] = ["name", "ext", "size", "date"];

function tabTarget(tab: PaneTab): string {
  return tab.locked && tab.lockedPath ? tab.lockedPath : tab.path;
}

function readTabs(value: unknown): PaneTab[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((tab): PaneTab[] => {
    if (typeof tab === "string" && tab.length > 0) return [{ path: tab, locked: false }];
    if (!tab || typeof tab !== "object") return [];
    const saved = tab as Record<string, unknown>;
    const locked = saved.locked === true;
    return typeof saved.path === "string" && saved.path.length > 0
      ? [
          {
            path: saved.path,
            locked,
            lockedPath:
              locked && typeof saved.lockedPath === "string" && saved.lockedPath.length > 0
                ? saved.lockedPath
                : undefined,
          },
        ]
      : [];
  });
}

function readPaneState(storageKey: string): PaneState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!value || typeof value !== "object") return {};
    const saved = value as Record<string, unknown>;
    const tabs = readTabs(saved.tabs);
    // Before tabs became explicit, the app persisted one automatic tab on startup.
    const legacySingleTab =
      Array.isArray(saved.tabs) &&
      saved.tabs.length === 1 &&
      typeof saved.tabs[0] === "string";
    return {
      sortKey: sortKeys.includes(saved.sortKey as SortKey) ? (saved.sortKey as SortKey) : undefined,
      sortAsc: typeof saved.sortAsc === "boolean" ? saved.sortAsc : undefined,
      tabs: legacySingleTab ? [] : tabs,
      activeTab:
        typeof saved.activeTab === "number" && Number.isInteger(saved.activeTab)
          ? Math.max(0, saved.activeTab)
          : undefined,
    };
  } catch {
    return {};
  }
}

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
  const dirs = entries.filter((e) => e.is_dir).sort(byName);
  const files = entries.filter((e) => !e.is_dir).sort(cmp);
  return [...dirs, ...files];
}

function lastPathName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
}

function wildcardToRegex(mask: string): RegExp {
  let pattern = "^";
  for (const char of mask) {
    if (char === "*") pattern += ".*";
    else if (char === "?") pattern += ".";
    else pattern += char.replace(/[\\^$+{}()[\]|.]/g, "\\$&");
  }
  return new RegExp(`${pattern}$`, "i");
}

function matchesMask(name: string, mask: string): boolean {
  const masks = mask
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!masks.length) return false;
  // Windows treats *.* as matching names both with and without an extension.
  return masks.some((part) => part === "*.*" || wildcardToRegex(part).test(name));
}

function useSettings() {
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem("showHidden") === "1");
  const [showSystem, setShowSystem] = useState(() => {
    const saved = localStorage.getItem("showSystem");
    return saved === null ? localStorage.getItem("showHidden") === "1" : saved === "1";
  });
  const [showExtensions, setShowExtensions] = useState(
    () => localStorage.getItem("showExtensions") === "1",
  );
  const [editorPath, setEditorPath] = useState(() => localStorage.getItem("editorPath") ?? "");
  const [startMaximized, setStartMaximized] = useState(
    () => localStorage.getItem("startMaximized") === "1",
  );
  useEffect(() => {
    localStorage.setItem("showHidden", showHidden ? "1" : "0");
  }, [showHidden]);
  useEffect(() => {
    localStorage.setItem("showSystem", showSystem ? "1" : "0");
  }, [showSystem]);
  useEffect(() => {
    localStorage.setItem("showExtensions", showExtensions ? "1" : "0");
  }, [showExtensions]);
  useEffect(() => {
    localStorage.setItem("editorPath", editorPath);
  }, [editorPath]);
  useEffect(() => {
    localStorage.setItem("startMaximized", startMaximized ? "1" : "0");
  }, [startMaximized]);
  return {
    showHidden,
    setShowHidden,
    showSystem,
    setShowSystem,
    showExtensions,
    setShowExtensions,
    editorPath,
    setEditorPath,
    startMaximized,
    setStartMaximized,
  };
}

function usePane(showHidden: boolean, showSystem: boolean, storageKey: string) {
  const persisted = useRef(readPaneState(storageKey)).current;
  const [drive, setDrive] = useState("");
  const [path, setPath] = useState("");
  const [rawEntries, setRawEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(persisted.sortKey ?? "name");
  const [sortAsc, setSortAsc] = useState(persisted.sortAsc ?? true);
  const [tabs, setTabs] = useState<PaneTab[]>(persisted.tabs ?? []);
  const [activeTab, setActiveTab] = useState(() =>
    Math.min(persisted.activeTab ?? 0, Math.max((persisted.tabs?.length ?? 1) - 1, 0)),
  );
  const activeTabRef = useRef(0);
  activeTabRef.current = activeTab;

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ sortKey, sortAsc, tabs, activeTab }));
  }, [storageKey, sortKey, sortAsc, tabs, activeTab]);

  const entries = useMemo(() => sortEntries(rawEntries, sortKey, sortAsc), [rawEntries, sortKey, sortAsc]);

  const load = useCallback(
    async (target: string, keepCursor = false, selectName?: string) => {
      try {
        const result = await invoke<Entry[]>("read_dir", {
          path: target,
          showHidden,
          showSystem,
        });
        setRawEntries(result);
        setPath(target);
        setError(null);
        setMarked(new Set());
        setEditing(false);
        const sorted = sortEntries(result, "name", true);
        const selectedDirectory = selectName
          ? sorted.findIndex((entry) => entry.is_dir && entry.name.toLowerCase() === selectName.toLowerCase())
          : -1;
        setCursor((c) => {
          if (selectedDirectory >= 0) return selectedDirectory + (isRoot(target) ? 0 : 1);
          return keepCursor ? Math.min(c, result.length) : 0;
        });
      } catch (e) {
        setError(String(e));
        setRawEntries([]);
        setPath(target);
      }
      // Keep the active tab pointed at the folder we just navigated to.
      setTabs((t) => {
        if (t.length === 0) return t;
        if (t[activeTabRef.current]?.path === target) return t;
        const n = [...t];
        n[activeTabRef.current] = { ...n[activeTabRef.current], path: target };
        return n;
      });
    },
    [showHidden, showSystem],
  );

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((a) => !a);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // Ctrl+T: duplicate the current folder into a new tab right after the current one.
  const newTab = () => {
    const dup: PaneTab = { path, locked: false };
    setTabs((t) => {
      if (t.length === 0) return [dup];
      const base = t;
      const idx = Math.min(activeTab, base.length - 1);
      return [...base.slice(0, idx + 1), dup, ...base.slice(idx + 1)];
    });
    const next = tabs.length === 0 ? 0 : activeTab + 1;
    activeTabRef.current = next;
    setActiveTab(next);
  };

  const switchTab = (i: number) => {
    if (i === activeTab || i < 0 || i >= tabs.length) return;
    activeTabRef.current = i;
    setActiveTab(i);
    load(tabTarget(tabs[i]));
  };

  const closeTab = (i: number) => {
    if (i < 0 || i >= tabs.length || tabs[i]?.locked) return;
    const next = tabs.filter((_, j) => j !== i);
    setTabs(next);
    let na = activeTab;
    if (i < activeTab) na = activeTab - 1;
    else if (i === activeTab) na = Math.min(activeTab, next.length - 1);
    activeTabRef.current = na;
    setActiveTab(na);
    if (i === activeTab && next.length > 0) load(tabTarget(next[na]));
  };

  const toggleTabLock = (i: number) => {
    if (i < 0 || i >= tabs.length) return;
    setTabs((t) =>
      t.map((tab, index) => {
        if (index !== i) return tab;
        return tab.locked
          ? { path: tab.path, locked: false }
          : { ...tab, locked: true, lockedPath: tab.path };
      }),
    );
  };

  const insertTab = (tab: PaneTab) => {
    const next = Math.min(activeTab + 1, tabs.length);
    setTabs((t) => [...t.slice(0, next), { ...tab }, ...t.slice(next)]);
    activeTabRef.current = next;
    setActiveTab(next);
    load(tab.path);
  };

  return {
    drive, setDrive, path, setPath, entries,
    cursor, setCursor, marked, setMarked, error, setError,
    editing, setEditing, sortKey, sortAsc, toggleSort, load,
    tabs, activeTab, newTab, switchTab, closeTab, toggleTabLock, insertTab,
  };
}

type Pane = ReturnType<typeof usePane>;

function App() {
  const settings = useSettings();
  const { showHidden, showSystem, showExtensions, editorPath } = settings;
  const [drives, setDrives] = useState<string[]>([]);
  const [activeSide, setActiveSide] = useState<Side>("left");
  const [view, setView] = useState<"files" | "settings">("files");
  const [showUpdates, setShowUpdates] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [tabMenu, setTabMenu] = useState<TabContextMenu | null>(null);
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
  const left = usePane(showHidden, showSystem, "paneState:left");
  const right = usePane(showHidden, showSystem, "paneState:right");
  const inited = useRef(false);

  useEffect(() => {
    invoke<string[]>("list_drives").then(setDrives).catch(() => setDrives([]));
    if (settings.startMaximized) {
      getCurrentWindow().maximize().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (drives.length && !inited.current) {
      inited.current = true;
      const initialPath = (pane: Pane) => {
        const tab = pane.tabs[pane.activeTab];
        return tab ? tabTarget(tab) : drives[0];
      };
      left.setDrive(drives[0]);
      left.load(initialPath(left));
      right.setDrive(drives[0]);
      right.load(initialPath(right));
    }
  }, [drives, left, right]);

  // Re-read both panes when the hidden/system-files settings change.
  useEffect(() => {
    if (inited.current) {
      left.load(left.path, true);
      right.load(right.path, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden, showSystem]);

  const paneFor = (side: Side) => (side === "left" ? left : right);
  const active = paneFor(activeSide);
  const other = paneFor(activeSide === "left" ? "right" : "left");

  const openTabMenu = (side: Side, index: number, x: number, y: number) => {
    setActiveSide(side);
    setTabMenu({ side, index, x, y });
  };

  const toggleTabLockFromMenu = () => {
    if (!tabMenu) return;
    const { side, index } = tabMenu;
    setTabMenu(null);
    paneFor(side).toggleTabLock(index);
  };

  const copyTabToOtherPanel = () => {
    if (!tabMenu) return;
    const { side, index } = tabMenu;
    const sourceTab = paneFor(side).tabs[index];
    setTabMenu(null);
    if (!sourceTab) return;
    const targetSide = side === "left" ? "right" : "left";
    paneFor(targetSide).insertTab(sourceTab);
  };

  const closeTabFromMenu = () => {
    if (!tabMenu) return;
    const { side, index } = tabMenu;
    setTabMenu(null);
    paneFor(side).closeTab(index);
  };

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
    const previousDirectory = lastPathName(pane.path);
    const parent = await invoke<string | null>("parent_dir", { path: pane.path });
    if (parent) pane.load(parent, false, previousDirectory);
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

  const selectByMask = (mask: string) => {
    const selectionMask = mask.trim() || "*.*";
    active.setMarked((current) => {
      const next = new Set(current);
      for (const entry of active.entries) {
        if (matchesMask(entry.name, selectionMask)) next.add(entry.path);
      }
      return next;
    });
    setDialog(null);
  };

  const deselectByMask = (mask: string) => {
    const selectionMask = mask.trim() || "*.*";
    active.setMarked((current) => {
      const next = new Set(current);
      for (const entry of active.entries) {
        if (matchesMask(entry.name, selectionMask)) next.delete(entry.path);
      }
      return next;
    });
    setDialog(null);
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
    activeSide, active, dialog, tabMenu, showUpdates, lister, view, alert,
    setActiveSide, setDialog, setTabMenu, setLister, setAlert, goUp, openRow, viewFile, editFile, doTransfer, askDelete, selectByMask, deselectByMask, exitApp,
    hasUp, maxRow,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = ks.current;
      if (s.tabMenu) {
        e.preventDefault();
        s.setTabMenu(null);
        return;
      }
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
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.code === "NumpadAdd" || e.key === "+")) {
        e.preventDefault();
        s.setDialog({ type: "select" });
        return;
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.code === "NumpadSubtract" || e.key === "-")) {
        e.preventDefault();
        s.setDialog({ type: "deselect" });
        return;
      }
      if (e.ctrlKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        pane.newTab();
        return;
      }
      if (e.ctrlKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        pane.closeTab(pane.activeTab);
        return;
      }
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (pane.tabs.length > 1) pane.switchTab((pane.activeTab + 1) % pane.tabs.length);
        return;
      }
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

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [tabMenu]);

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
        showExtensions={showExtensions}
        tabs={pane.tabs}
        activeTab={pane.activeTab}
        onTabContext={(i, x, y) => openTabMenu(side, i, x, y)}
        onTabSelect={(i) => {
          setActiveSide(side);
          pane.switchTab(i);
        }}
        onTabClose={(i) => pane.closeTab(i)}
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
        onPathEditStart={() => {
          setActiveSide(side);
          pane.setEditing(true);
        }}
        onPathSubmit={(v) => pane.load(v)}
        onPathCancel={() => pane.setEditing(false)}
      />
    );
  };

  const tabMenuTab = tabMenu ? paneFor(tabMenu.side).tabs[tabMenu.index] : null;
  const tabMenuStyle = tabMenu
    ? {
        left: Math.max(4, Math.min(tabMenu.x, window.innerWidth - 196)),
        top: Math.max(4, Math.min(tabMenu.y, window.innerHeight - 124)),
      }
    : undefined;

  return (
    <div className="app" onContextMenuCapture={(e) => e.preventDefault()}>
      <header className="app-header">
        <h1>Tauri Commander</h1>
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

      {tabMenu && tabMenuTab && (
        <div
          className="tab-context-menu"
          style={tabMenuStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={toggleTabLockFromMenu}>
            {tabMenuTab.locked ? "Unlock" : "Lock"}
          </button>
          <button type="button" onClick={copyTabToOtherPanel}>
            Copy to other panel
          </button>
          <button type="button" disabled={tabMenuTab.locked} onClick={closeTabFromMenu}>
            Close
          </button>
        </div>
      )}

      {dialog?.type === "mkdir" && (
        <MkdirDialog onSubmit={doMkdir} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === "select" && (
        <SelectMaskDialog action="select" onSubmit={selectByMask} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === "deselect" && (
        <SelectMaskDialog action="deselect" onSubmit={deselectByMask} onCancel={() => setDialog(null)} />
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

function SelectMaskDialog({
  action,
  onSubmit,
  onCancel,
}: {
  action: "select" | "deselect";
  onSubmit: (mask: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [mask, setMask] = useState("*.*");
  const deselect = action === "deselect";

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="update-overlay" onClick={onCancel}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-header">
          <h3>{deselect ? "Unselect group" : "Select group"}</h3>
        </div>
        <div className="update-body">
          <label className="dialog-label" htmlFor="select-mask">
            File mask
          </label>
          <input
            ref={ref}
            id="select-mask"
            className="dialog-input"
            value={mask}
            onChange={(e) => setMask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit(mask);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <div className="update-footer">
          <button type="button" className="update-primary" onClick={() => onSubmit(mask)}>
            {deselect ? "Unselect" : "Select"}
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
