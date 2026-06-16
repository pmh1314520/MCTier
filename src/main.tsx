import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeStore } from './stores';

// 初始化应用 Store
initializeStore();

// 应用持久化的主题主色（提示音与主题设置）
try {
  const primary = localStorage.getItem('mctier_theme_primary');
  if (primary) document.documentElement.style.setProperty('--mctier-primary', primary);
} catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
