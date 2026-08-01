import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  showHidden: boolean;
  setShowHidden: (value: boolean) => void;
  showSystem: boolean;
  setShowSystem: (value: boolean) => void;
  showExtensions: boolean;
  setShowExtensions: (value: boolean) => void;
  editorPath: string;
  setEditorPath: (value: string) => void;
  startMaximized: boolean;
  setStartMaximized: (value: boolean) => void;
  onBack: () => void;
}

export function Settings({
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
  onBack,
}: Props) {
  const browse = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Choose editor program",
    });
    if (typeof picked === "string") setEditorPath(picked);
  };

  return (
    <div className="settings">
      <div className="settings-row settings-inline">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden files
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
          />
          Show system files
        </label>
      </div>

      <div className="settings-row">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={showExtensions}
            onChange={(e) => setShowExtensions(e.target.checked)}
          />
          Show file extensions directly after file name
        </label>
      </div>

      <div className="settings-row">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={startMaximized}
            onChange={(e) => setStartMaximized(e.target.checked)}
          />
          Start maximized
        </label>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="editor-path">
          F4 editor path
        </label>
        <div className="settings-editor-row">
          <input
            id="editor-path"
            className="dialog-input"
            value={editorPath}
            placeholder="e.g. C:\Windows\notepad.exe (leave empty for system default)"
            onChange={(e) => setEditorPath(e.target.value)}
          />
          <button type="button" onClick={browse}>
            Browse…
          </button>
        </div>
        <p className="settings-hint">
          Full path to the program F4 opens files with. Empty = the OS default editor.
        </p>
      </div>

      <div className="settings-actions">
        <button type="button" onClick={onBack}>
          Back to files
        </button>
      </div>
    </div>
  );
}
