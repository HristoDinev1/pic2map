import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './auth/amplify';
import './index.css';

import { AuthProvider } from './auth/AuthContext';
import Navbar from './components/Navbar';
import MapView from './pages/MapView';
import Gallery from './pages/Gallery';
import Upload from './pages/Upload';
import Albums from './pages/Albums';
import AlbumDetail from './pages/AlbumDetail';
import Search from './pages/Search';
import Moderation from './pages/Moderation';
import Admin from './pages/Admin';

function Shell() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <main className="max-w-6xl mx-auto p-4">
          <Routes>
            <Route path="/" element={<MapView />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/albums" element={<Albums />} />
            <Route path="/albums/:id" element={<AlbumDetail />} />
            <Route path="/search" element={<Search />} />
            <Route path="/moderation" element={<Moderation />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Amplify Authenticator gates the whole app: sign-up, sign-in,
        password recovery and JWT management are handled by Cognito. */}
    <Authenticator signUpAttributes={['email']}>
      {() => <Shell />}
    </Authenticator>
  </React.StrictMode>
);
