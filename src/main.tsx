import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/common/ToastProvider';
import '@fontsource-variable/inter';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource-variable/geist';
import '@fontsource/google-sans-flex/400.css';
import '@fontsource/google-sans-flex/500.css';
import '@fontsource/google-sans-flex/600.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/monaspace-neon/300.css';
import '@fontsource/monaspace-neon/300-italic.css';
import '@fontsource-variable/fira-code';
import '@fontsource/fira-mono/400.css';
import '@fontsource/source-code-pro/300.css';
import '@fontsource-variable/geist-mono';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ToastProvider><App /></ToastProvider>,
);
