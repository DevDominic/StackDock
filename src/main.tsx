import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/common/ToastProvider';
import { PromptProvider } from './components/common/PromptProvider';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ToastProvider><PromptProvider><App /></PromptProvider></ToastProvider>,
);
