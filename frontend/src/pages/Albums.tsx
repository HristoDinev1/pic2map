import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Album } from '../types';

export default function Albums() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [name, setName] = useState('');

  const load = () => api.get<{ albums: Album[] }>('/albums').then((r) => setAlbums(r.albums));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await api.post('/albums', { name }); setName(''); load();
  };
  const remove = async (id: string) => {
    if (!confirm('Delete album?')) return;
    await api.del(`/albums/${id}`); load();
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Albums</h1>
      <div className="flex gap-2 mb-4">
        <input className="border rounded p-2 text-sm flex-1" placeholder="New album name"
          value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={create} className="bg-brand text-white px-4 rounded text-sm">Create</button>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {albums.map((a) => (
          <div key={a.id} className="bg-white rounded-lg shadow-sm p-3">
            <Link to={`/albums/${a.id}`} className="font-medium text-brand">{a.name}</Link>
            <div className="text-xs text-slate-500">{a.photo_count ?? 0} photos · {a.visibility}</div>
            <button onClick={() => remove(a.id)} className="text-red-600 text-xs mt-2">Delete</button>
          </div>
        ))}
      </div>
      {!albums.length && <p className="text-slate-500">No albums yet.</p>}
    </div>
  );
}
