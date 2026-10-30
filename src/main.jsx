import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-500.css';
import '@fontsource/noto-sans-bengali/bengali-600.css';
import '@fontsource/noto-sans-bengali/bengali-700.css';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
