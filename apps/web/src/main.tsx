import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api';
import { SessionBoundary } from './session';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: {
  staleTime: 15_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true,
  retry: (count, error) => !(error instanceof ApiError && [401, 403, 409, 422].includes(error.status)) && count < 1,
}, mutations: { retry: false } } });
const root = document.getElementById('root');
if (!root) throw new Error('缺少应用挂载节点 #root');
createRoot(root).render(<StrictMode><QueryClientProvider client={queryClient}><SessionBoundary><App /></SessionBoundary></QueryClientProvider></StrictMode>);
