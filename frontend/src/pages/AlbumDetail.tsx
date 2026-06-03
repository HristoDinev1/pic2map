import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Album, Photo } from '../types';
import PhotoCard from '../components/PhotoCard';

export default function AlbumDetail() {
  const { id } = useParams();
  const [album, setAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [mine, setMine] = useState<Photo[]>([]);

  const load = () => {
    api.get<{ album: Album; photos: Photo[] }>(`/albums/${id}`)
      .then((r) => { setAlbum(r.album); setPhotos(r.photos); });
    api.get<{ photos: Photo[] }>('/photos').then((r) => setMine(r.photos));
  };
  useEffect(() => { load(); }, [id]);

  const add = async (photoId: string) => { await api.post(`/albums/${id}/photos`, { photoId }); load(); };
  const remove = async (photoId: string) => { await api.del(`/albums/${id}/photos/${photoId}`); load(); };

  const inAlbum = new Set(photos.map((p) => p.id));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">{album?.name}</h1>
      <p className="text-sm text-slate-500 mb-4">{album?.description}</p>

      <h2 className="font-medium mb-2">In this album</h2>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">
        {photos.map((p) => (
          <div key={p.id}>
            <PhotoCard photo={p} />
            <button onClick={() => remove(p.id)} className="text-red-600 text-xs mt-1">Remove</button>
          </div>
        ))}
      </div>

      <h2 className="font-medium mb-2">Add from your gallery</h2>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        {mine.filter((p) => !inAlbum.has(p.id)).map((p) => (
          <div key={p.id}>
            <PhotoCard photo={p} />
            <button onClick={() => add(p.id)} className="text-brand text-xs mt-1">+ Add</button>
          </div>
        ))}
      </div>
    </div>
  );
}
