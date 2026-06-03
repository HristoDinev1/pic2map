import { Photo } from '../types';

export default function PhotoCard({ photo, onClick }: { photo: Photo; onClick?: () => void }) {
  const img = photo.urls.thumb ?? photo.urls.medium ?? photo.urls.original;
  return (
    <button onClick={onClick}
      className="text-left bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition">
      <div className="aspect-square bg-slate-200">
        {img
          ? <img src={img} alt={photo.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="flex items-center justify-center h-full text-xs text-slate-400">
              {photo.processState === 'READY' ? 'no preview' : photo.processState}
            </div>}
      </div>
      <div className="p-2">
        <div className="font-medium text-sm truncate">{photo.title}</div>
        <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
          <span>{photo.visibility === 'PUBLIC' ? '🌍 Public' : '🔒 Private'}</span>
          {photo.latitude != null && <span>📍</span>}
        </div>
      </div>
    </button>
  );
}
