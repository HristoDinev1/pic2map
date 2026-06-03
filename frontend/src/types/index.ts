export type Role = 'USER' | 'MODERATOR' | 'ADMIN';

export interface Photo {
  id: string;
  ownerId: string;
  ownerUsername?: string;
  title: string;
  description: string | null;
  urls: { original: string | null; thumb: string | null; medium: string | null; large: string | null };
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  status: string;
  processState: string;
  createdAt: string;
}

export interface Album {
  id: string; name: string; description: string | null;
  visibility: 'PUBLIC' | 'PRIVATE'; photo_count?: number; created_at: string;
}

export interface Profile { id: string; username: string; email: string; role: Role; }
