// Runtime configuration for the static frontend (no build step / bundler, so no
// Vite "import.meta.env" — plain globals set before the app modules load).
//
// Copy this file to config.js (gitignored) and fill in your values:
//   cd frontend/js && cp config.example.js config.js
window.PIC2MAP_CONFIG = {
  apiBase: 'http://localhost:4000/api',

  // Auth driver: 'local' (self-hosted accounts on this backend, no AWS needed)
  // or 'cognito' (original Amazon Cognito flow). When omitted, 'cognito' is
  // auto-selected only if cognitoClientId below looks real, otherwise 'local'.
  authDriver: 'local',

  // Only needed for authDriver: 'cognito'
  cognitoRegion: 'eu-central-1',
  cognitoClientId: '',
};
