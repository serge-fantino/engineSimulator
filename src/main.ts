import { App } from './app';

// Register service worker for PWA installability (e.g. "Add to Home Screen" on mobile)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}

// App is created — engine starts via the ON/OFF power toggle in the controls panel
new App();
