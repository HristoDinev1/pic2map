import { useState } from 'react';
import { api } from '../api/client';
import { Photo } from '../types';
import PhotoCard from '../components/PhotoCard';

export default function Search() {
  const [f, setF] = useState({ username: '', album: '', title: '', dateFrom: '', dateTo: '' });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [done, setDone] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const run = async () => {
    const qs = new URLSearchParams(
      Object.entries(f).filter(([, v]) => v) as [string, string][]
    ).toString();
    const r = await api.get<{ photos: Photo[] }>(`/search?${qs}`);
    setPhotos(r.photos); setDone(true);
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Search</h1>
      <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <input className="border rounded p-2 text-sm" placeholder="Username" onChange={set('username')} />
        <input className="border rounded p-2 text-sm" placeholder="Album" onChange={set('album')} />
        <input className="border rounded p-2 text-sm" placeholder="Photo title" onChange={set('title')} />
        <input type="date" className="border rounded p-2 text-sm" onChange={set('dateFrom')} />
        <input type="date" className="border rounded p-2 text-sm" onChange={set('dateTo')} />
      </div>
      <button onClick={run} className="bg-brand text-white px-4 py-2 rounded text-sm mb-4">Search</button>
      <p className="text-xs text-slate-500 mb-2">
        GPS-area search is also supported via the map bounding box (minLat/minLng/maxLat/maxLng).
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {photos.map((p) => <PhotoCard key={p.id} photo={p} />)}
      </div>
      {done && !photos.length && <p className="text-slate-500">No results.</p>}
    </div>
  );
}
