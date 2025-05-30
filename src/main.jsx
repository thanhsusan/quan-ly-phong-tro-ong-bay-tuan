import React from 'react';
import ReactDOM from 'react-dom/client';
import WrappedApp from './App.jsx'; // Đảm bảo đúng tên tệp App.jsx và import WrappedApp
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WrappedApp /> {/* Render WrappedApp ở đây */}
  </React.StrictMode>,
);