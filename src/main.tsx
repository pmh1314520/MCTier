import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeStore } from './stores';

// 初始化应用 Store
initializeStore();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
