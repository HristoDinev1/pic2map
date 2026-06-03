import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-200'}`;

export default function Navbar() {
  const { profile, logout } = useAuth();
  const role = profile?.role ?? 'USER';
  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-1 h-14 flex-wrap">
        <span className="font-bold text-brand text-lg mr-4">PIC2MAP</span>
        <NavLink to="/" className={link} end>Map</NavLink>
        <NavLink to="/gallery" className={link}>Gallery</NavLink>
        <NavLink to="/albums" className={link}>Albums</NavLink>
        <NavLink to="/search" className={link}>Search</NavLink>
        <NavLink to="/upload" className={link}>Upload</NavLink>
        {(role === 'MODERATOR' || role === 'ADMIN') &&
          <NavLink to="/moderation" className={link}>Moderation</NavLink>}
        {role === 'ADMIN' && <NavLink to="/admin" className={link}>Admin</NavLink>}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-slate-500">{profile?.username} · {role}</span>
          <button onClick={logout} className="text-red-600 hover:underline">Sign out</button>
        </div>
      </div>
    </nav>
  );
}
