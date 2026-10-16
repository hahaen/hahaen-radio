import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../locales/i18n';
import '../styles/fonts.css';
import '../styles/global.css';
import { App } from './App';

const element = document.getElementById('root');
if (!element) throw new Error('Missing application root');
const queryClient = new QueryClient();
createRoot(element).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
