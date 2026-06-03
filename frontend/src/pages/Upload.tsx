import { useState } from 'react';
import { uploadPhoto } from '../api/client';

export default function Upload() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const submit = async () => {
    if (!files?.length) return;
    setBusy(true); setLog([]);
    for (const file of Array.from(files)) {
      try {
        await uploadPhoto(file, file.name);
        setLog((l) => [...l, `✓ ${file.name} uploaded — processing in the cloud…`]);
      } catch (e: any) {
        setLog((l) => [...l, `✗ ${file.name}: ${e.message}`]);
      }
    }
    setBusy(false);
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold mb-3">Upload photos</h1>
      <input type="file" multiple accept="image/*"
        onChange={(e) => setFiles(e.target.files)}
        className="block w-full text-sm mb-3" />
      <button onClick={submit} disabled={busy || !files?.length}
        className="bg-brand text-white px-4 py-2 rounded-md disabled:opacity-50">
        {busy ? 'Uploading…' : 'Upload'}
      </button>
      <p className="text-xs text-slate-500 mt-2">
        Originals go straight to S3. A Lambda then extracts GPS/EXIF and builds
        thumbnails — they appear in your gallery once processing finishes.
      </p>
      <ul className="mt-4 space-y-1 text-sm">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}
