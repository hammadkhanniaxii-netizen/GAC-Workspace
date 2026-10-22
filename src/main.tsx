import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {registerSW} from 'virtual:pwa-register';

// Register service worker with auto-update
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[PWA] New content available. Automatically updating...');
  },
  onOfflineReady() {
    console.log('[PWA] GA Workspace is cached and ready for offline use.');
  },
});

createRoot(document.getElementById('root')!).render(<App />);
