import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeStore } from './stores';

// 初始化应用 Store
initializeStore();

// 主题主色配置已移除，统一使用品牌绿；清理历史遗留的自定义主色，避免旧的橙色等残留
try {
  localStorage.removeItem('mctier_theme_primary');
  document.documentElement.style.removeProperty('--mctier-primary');
} catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
