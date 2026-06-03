import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Photo } from '../types';

export default function Moderation() {
  const [queue, setQueue] = useState<Photo[]>([]);
  const load = () => api.get<{ photos: Photo[] }>('/moderation/queue').then((r) => setQueue(r.photos));
  useEffect(() => { load(); }, []);

  const act = async (id: string, action: 'APPROVE' | 'REJECT' | 'DELETE') => {
    await api.post(`/moderation/photos/${id}`, { action }); load();
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Moderation queue</h1>
      {!queue.length && <p className="text-slate-500">Nothing pending review.</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {queue.map((p) => (
          <div key={p.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
            {p.urls.medium && <img src={p.urls.medium} className="w-full h-36 object-cover" />}
            <div className="p-2">
              <div className="text-sm font-medium truncate">{p.title}</div>
              <div className="text-xs text-slate-500">by {p.ownerUsername}</div>
              <div className="flex gap-1 mt-2">
                <button onClick={() => act(p.id, 'APPROVE')}
                  className="bg-emerald-600 text-white text-xs px-2 py-1 rounded">Approve</button>
                <button onClick={() => act(p.id, 'REJECT')}
                  className="bg-amber-500 text-white text-xs px-2 py-1 rounded">Reject</button>
                <button onClick={() => act(p.id, 'DELETE')}
                  className="bg-red-600 text-white text-xs px-2 py-1 rounded">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
