interface Props {
  name: string;
  content: string;
  onClose: () => void;
}

export function Lister({ name, content, onClose }: Props) {
  return (
    <div className="lister">
      <div className="lister-header">
        <h3 title={name}>{name}</h3>
        <button type="button" className="update-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <pre className="lister-body">{content}</pre>
      <div className="lister-footer">
        <span className="update-muted">F3 / Esc to close</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
