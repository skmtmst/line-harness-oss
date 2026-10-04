import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { initLiff } from './lib/liff-auth.js';
import './index.css';

(async () => {
  try {
    await initLiff();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  } catch (err) {
    console.error('[liff:init]', err);
    document.getElementById('root')!.innerHTML = `
      <div style="padding: 2rem; font-family: sans-serif; color: #4b5563; text-align: center;">
        <h1 style="font-size: 1rem; margin-bottom: 0.5rem;">開けませんでした</h1>
        <p style="font-size: 0.875rem;">時間をおいて、もう一度お試しください。</p>
      </div>
    `;
  }
})();
