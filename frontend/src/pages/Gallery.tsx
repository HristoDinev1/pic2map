import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Photo } from '../types';
import PhotoCard from '../components/PhotoCard';
import PhotoEditor from '../components/PhotoEditor';

export default function Gallery() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Photo | null>(null);

  const load = () => api.get<{ photos: Photo[] }>('/photos').then((r) => setPhotos(r.photos));
  useEffect(() => { load(); }, []);

  // Authenticated download (anchor links can't send the bearer token).
  const download = async (kind: 'json' | 'csv') => {
    const res = await fetch(`${api.base}/transfer/export.${kind}`, { headers: await api.authHeader() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pic2map-export.${kind}`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-semibold">My gallery</h1>
        <div className="flex gap-3 text-sm">
          <button onClick={() => download('json')} className="text-brand">Export JSON</button>
          <button onClick={() => download('csv')} className="text-brand">Export CSV</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {photos.map((p) => <PhotoCard key={p.id} photo={p} onClick={() => setSelected(p)} />)}
      </div>
      {!photos.length && <p className="text-slate-500">No photos yet — upload some!</p>}
      {selected && <PhotoEditor photo={selected}
        onChange={() => { load(); }} onClose={() => setSelected(null)} />}
    </div>
  );
}
