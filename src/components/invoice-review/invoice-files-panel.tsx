type InvoiceFile = {
  id: number;
  originalFilename: string;
  storedPath: string;
  displayFilename: string;
  sha256: string;
  sizeBytes: number;
  sourceType: string;
};

export function InvoiceFilesPanel({ files }: { files: InvoiceFile[] }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted">Keine Dateien vorhanden.</p>;
  }
  return (
    <div className="space-y-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="space-y-2 border-b border-line pb-4 last:border-b-0 last:pb-0"
        >
          <div className="text-sm font-medium">{file.displayFilename}</div>
          {file.originalFilename !== file.displayFilename ? (
            <div className="text-xs text-muted">{file.originalFilename}</div>
          ) : null}
          <div className="text-xs text-muted">{file.storedPath}</div>
          <dl className="grid gap-2 text-xs text-muted">
            <div className="flex items-center justify-between gap-3">
              <dt>Quelle</dt>
              <dd>{file.sourceType}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>Größe</dt>
              <dd>{formatFileSize(file.sizeBytes)}</dd>
            </div>
            <div className="space-y-1">
              <dt>SHA256</dt>
              <dd className="break-all font-mono">{file.sha256}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
