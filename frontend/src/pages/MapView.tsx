import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import '../components/leafletIcon';
import { api } from '../api/client';
import { Photo } from '../types';

export default function MapView() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ photos: Photo[] }>('/map/photos')
      .then((r) => setPhotos(r.photos.filter((p) => p.latitude != null)))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Map</h1>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <div className="h-[70vh] rounded-lg overflow-hidden border border-slate-200">
        <MapContainer center={[42.6977, 23.3219]} zoom={4} className="h-full w-full">
          {/* OpenStreetMap tiles */}
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MarkerClusterGroup chunkedLoading>
            {photos.map((p) => (
              <Marker key={p.id} position={[p.latitude!, p.longitude!]}>
                <Popup>
                  <div className="w-44">
                    {p.urls.thumb && (
                      <img src={p.urls.thumb} alt={p.title}
                           className="w-full h-28 object-cover rounded mb-1" />
                    )}
                    <div className="font-semibold text-sm">{p.title}</div>
                    <div className="text-xs text-slate-600">by {p.ownerUsername}</div>
                    <div className="text-xs text-slate-600">
                      {p.latitude!.toFixed(5)}, {p.longitude!.toFixed(5)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Uploaded {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </div>
      <p className="text-sm text-slate-500 mt-2">{photos.length} geotagged photos shown.</p>
    </div>
  );
}
