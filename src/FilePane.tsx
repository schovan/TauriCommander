import { useEffect, useRef } from "react";

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
  hidden: boolean;
  system: boolean;
}

export type SortKey = "name" | "ext" | "size" | "date";

export interface PaneTab {
  path: string;
  locked: boolean;
  lockedPath?: string;
}

export function isRoot(p: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(p) || p === "/" || p === "";
}

export function splitExt(name: string, isDir: boolean): { base: string; ext: string } {
  if (isDir) return { base: name, ext: "" };
  const dot = name.lastIndexOf(".");
  if (dot > 0) return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
  return { base: name, ext: "" };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatDate(secs: number | null): string {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function tabLabel(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

interface Props {
  active: boolean;
  drives: string[];
  drive: string;
  path: string;
  entries: Entry[];
  cursor: number;
  marked: Set<string>;
  error: string | null;
  editing: boolean;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  tabs: PaneTab[];
  activeTab: number;
  onTabSelect: (index: number) => void;
  onTabContext: (index: number, x: number, y: number) => void;
  onTabClose: (index: number) => void;
  onActivate: () => void;
  onDriveChange: (drive: string) => void;
  onRowClick: (row: number) => void;
  onRowContext: (row: number) => void;
  onRowOpen: (row: number) => void;
  onUp: () => void;
  onPathEditStart: () => void;
  onPathSubmit: (value: string) => void;
  onPathCancel: () => void;
}

export function FilePane(props: Props) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasUp = !isRoot(props.path);

  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [props.cursor, props.entries]);

  useEffect(() => {
    if (props.editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [props.editing]);

  const sortArrow = (key: SortKey) => (props.sortKey === key ? (props.sortAsc ? "▲" : "▼") : "");
  const sortLabel = (key: SortKey, label: string) => (
    <>
      <span className="sort-arrow" aria-hidden="true">
        {sortArrow(key)}
      </span>
      {label}
    </>
  );

  return (
    <div className={`pane${props.active ? " active" : ""}`} onMouseDown={props.onActivate}>
      <div className="pane-toolbar">
        <select value={props.drive} onChange={(e) => props.onDriveChange(e.target.value)}>
          {props.drives.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {hasUp && (
          <button type="button" className="pane-up" onClick={props.onUp} title="Up one level">
            ⬆
          </button>
        )}
      </div>

      {props.tabs.length > 0 && (
        <div className="pane-tabs">
          {props.tabs.map((t, i) => (
            <div
              key={i}
              className={`pane-tab${i === props.activeTab ? " active" : ""}`}
              title={t.path}
              onMouseDown={(e) => {
                if (e.button === 2) {
                  e.preventDefault();
                } else if (e.button === 1) {
                  e.preventDefault();
                  props.onTabClose(i);
                } else {
                  props.onTabSelect(i);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onTabContext(i, e.clientX, e.clientY);
              }}
            >
              <span className="pane-tab-label">
                {t.locked ? "*" : ""}
                {tabLabel(t.locked && t.lockedPath ? t.lockedPath : t.path)}
              </span>
            </div>
          ))}
        </div>
      )}

      {props.editing ? (
        <input
          ref={inputRef}
          className="pane-path-edit"
          defaultValue={props.path}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onPathSubmit((e.target as HTMLInputElement).value);
            else if (e.key === "Escape") props.onPathCancel();
          }}
          onBlur={props.onPathCancel}
        />
      ) : (
        <div className="pane-path" title={props.path} onDoubleClick={props.onPathEditStart}>
          {props.path}
        </div>
      )}

      <div className="pane-header">
        <button type="button" className="col-name" onClick={() => props.onSort("name")}>
          {sortLabel("name", "Name")}
        </button>
        <button type="button" className="col-ext" onClick={() => props.onSort("ext")}>
          {sortLabel("ext", "Ext")}
        </button>
        <button type="button" className="col-size" onClick={() => props.onSort("size")}>
          {sortLabel("size", "Size")}
        </button>
        <button type="button" className="col-date" onClick={() => props.onSort("date")}>
          {sortLabel("date", "Date")}
        </button>
      </div>

      <div className="pane-list">
        {hasUp && (
          <div
            ref={props.cursor === 0 ? cursorRef : null}
            className={`pane-row pane-updir${props.cursor === 0 ? " cursor" : ""}`}
            onClick={() => props.onRowClick(0)}
            onDoubleClick={() => props.onRowOpen(0)}
          >
            <span className="col-name">📁 ..</span>
            <span className="col-ext"></span>
            <span className="col-size"></span>
            <span className="col-date"></span>
          </div>
        )}

        {props.error && <div className="pane-error">{props.error}</div>}

        {props.entries.map((entry, i) => {
          const row = i + (hasUp ? 1 : 0);
          const isCursor = props.cursor === row;
          const isMarked = props.marked.has(entry.path);
          const { base, ext } = splitExt(entry.name, entry.is_dir);
          return (
            <div
              key={entry.path}
              ref={isCursor ? cursorRef : null}
              className={`pane-row${isCursor ? " cursor" : ""}${isMarked ? " marked" : ""}`}
              onClick={() => props.onRowClick(row)}
              onDoubleClick={() => props.onRowOpen(row)}
              onContextMenu={(e) => {
                e.preventDefault();
                props.onRowContext(row);
              }}
            >
              <span className="col-name">
                <span className={`entry-icon${entry.hidden ? " dimmed" : ""}`}>
                  {entry.is_dir ? "📁" : "📄"}
                  {entry.system && <span className="entry-sys">!</span>}
                </span>{" "}
                {base}
              </span>
              <span className="col-ext">{ext}</span>
              <span className="col-size">{entry.is_dir ? "<DIR>" : formatSize(entry.size)}</span>
              <span className="col-date">{formatDate(entry.modified)}</span>
            </div>
          );
        })}
      </div>

      <div className="pane-status">
        {props.marked.size > 0
          ? `${props.marked.size} selected`
          : `${props.entries.filter((e) => e.is_dir).length} dirs, ${
              props.entries.filter((e) => !e.is_dir).length
            } files`}
      </div>
    </div>
  );
}
