import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
}

const ACCEPT = '.xlsx,.xls';

function isExcel(file: File): boolean {
  return /\.(xlsx|xls)$/i.test(file.name);
}

export function FileUpload({ onFile, disabled, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!isExcel(file)) {
      setLocalError('Please select an Excel workbook (.xlsx or .xls).');
      return;
    }
    setLocalError(null);
    onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    accept(e.dataTransfer.files?.[0]);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    accept(e.target.files?.[0]);
    e.target.value = '';
  };

  if (compact) {
    return (
      <div className="upload-compact">
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={onChange} hidden />
        <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
          Load a different Order Tracker
        </button>
        {localError && <span className="error-text">{localError}</span>}
      </div>
    );
  }

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click(); }}
    >
      <input ref={inputRef} type="file" accept={ACCEPT} onChange={onChange} hidden />
      <div className="dropzone-icon" aria-hidden="true">⬆</div>
      <p className="dropzone-title">Drag and drop the Order Tracker workbook here</p>
      <p className="dropzone-sub">Accepted formats: .xlsx, .xls — the file is analyzed in your browser and never uploaded.</p>
      <button type="button" className="btn btn-primary btn-large" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }} disabled={disabled}>
        SELECT ORDER TRACKER
      </button>
      {localError && <p className="error-text">{localError}</p>}
    </div>
  );
}
