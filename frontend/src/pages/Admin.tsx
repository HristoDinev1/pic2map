import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Stats { total_users: number; total_moderators: number; total_admins: number;
  total_photos: number; public_photos: number; pending_photos: number;
  geotagged_photos: number; total_albums: number; total_storage_bytes: number; }
interface User { id: string; username: string; email: string; role: string; is_active: boolean; }

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const load = () => {
    api.get<{ stats: Stats }>('/admin/stats').then((r) => setStats(r.stats));
    api.get<{ users: User[] }>('/admin/users').then((r) => setUsers(r.users));
  };
  useEffect(() => { load(); }, []);

  const setRole = async (id: string, role: string) => { await api.patch(`/admin/users/${id}/role`, { role }); load(); };
  const toggle = async (u: User) => { await api.patch(`/admin/users/${u.id}/active`, { active: !u.is_active }); load(); };

  const card = (label: string, value: number | string) => (
    <div className="bg-white rounded-lg shadow-sm p-3">
      <div className="text-2xl font-bold text-brand">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Admin dashboard</h1>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {card('Users', stats.total_users)}
          {card('Moderators', stats.total_moderators)}
          {card('Photos', stats.total_photos)}
          {card('Public', stats.public_photos)}
          {card('Geotagged', stats.geotagged_photos)}
          {card('Pending review', stats.pending_photos)}
          {card('Albums', stats.total_albums)}
          {card('Storage (MB)', Math.round(stats.total_storage_bytes / 1e6))}
        </div>
      )}

      <h2 className="font-medium mb-2">Users</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm bg-white rounded-lg overflow-hidden">
          <thead className="bg-slate-100 text-left">
            <tr><th className="p-2">Username</th><th className="p-2">Email</th>
                <th className="p-2">Role</th><th className="p-2">Active</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.username}</td>
                <td className="p-2 text-slate-500">{u.email}</td>
                <td className="p-2">
                  <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)}
                    className="border rounded p-1">
                    <option>USER</option><option>MODERATOR</option><option>ADMIN</option>
                  </select>
                </td>
                <td className="p-2">
                  <button onClick={() => toggle(u)}
                    className={u.is_active ? 'text-emerald-600' : 'text-red-600'}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
