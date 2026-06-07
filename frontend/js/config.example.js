// Runtime configuration for the static frontend (no build step / bundler, so no
// Vite "import.meta.env" — plain globals set before the app modules load).
//
// Copy this file to config.js (gitignored) and fill in your values:
//   cd frontend/js && cp config.example.js config.js
window.PIC2MAP_CONFIG = {
  apiBase: 'http://localhost:4000/api',
  cognitoRegion: 'eu-central-1',
  cognitoClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
};
