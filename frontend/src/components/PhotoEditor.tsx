import { useState } from 'react';
import { api } from '../api/client';
import { Photo } from '../types';

export default function PhotoEditor({ photo, onChange, onClose }:
  { photo: Photo; onChange: () => void; onClose: () => void }) {
  const [title, setTitle] = useState(photo.title);
  const [visibility, setVisibility] = useState(photo.visibility);
  const [lat, setLat] = useState(photo.latitude?.toString() ?? '');
  const [lng, setLng] = useState(photo.longitude?.toString() ?? '');
  const [msg, setMsg] = useState('');

  const saveMeta = async () => {
    await api.patch(`/photos/${photo.id}`, { title, visibility });
    setMsg('Saved'); onChange();
  };
  const saveGps = async (clear = false) => {
    await api.put(`/photos/${photo.id}/gps`, clear
      ? { latitude: null, longitude: null }
      : { latitude: Number(lat), longitude: Number(lng) });
    setMsg(clear ? 'GPS removed' : 'GPS updated'); onChange();
  };
  const remove = async () => {
    if (!confirm('Delete this photo?')) return;
    await api.del(`/photos/${photo.id}`); onChange(); onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-20 p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg p-4 w-full max-w-md space-y-3"
           onClick={(e) => e.stopPropagation()}>
        {photo.urls.medium && <img src={photo.urls.medium} alt={photo.title}
          className="w-full h-48 object-cover rounded" />}
        <input className="border rounded w-full p-2 text-sm" value={title}
          onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <select className="border rounded w-full p-2 text-sm" value={visibility}
          onChange={(e) => setVisibility(e.target.value as any)}>
          <option value="PRIVATE">Private</option>
          <option value="PUBLIC">Public</option>
        </select>
        <button onClick={saveMeta} className="bg-brand text-white px-3 py-1.5 rounded text-sm">
          Save details
        </button>

        <div className="border-t pt-3">
          <p className="text-sm font-medium mb-1">GPS coordinates</p>
          <div className="flex gap-2">
            <input className="border rounded p-2 text-sm w-1/2" placeholder="latitude"
              value={lat} onChange={(e) => setLat(e.target.value)} />
            <input className="border rounded p-2 text-sm w-1/2" placeholder="longitude"
              value={lng} onChange={(e) => setLng(e.target.value)} />
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => saveGps(false)}
              className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm">Set / update</button>
            <button onClick={() => saveGps(true)}
              className="bg-slate-200 px-3 py-1.5 rounded text-sm">Remove</button>
          </div>
        </div>

        <div className="flex justify-between items-center border-t pt-3">
          <button onClick={remove} className="text-red-600 text-sm">Delete photo</button>
          <span className="text-emerald-600 text-sm">{msg}</span>
        </div>
      </div>
    </div>
  );
}
