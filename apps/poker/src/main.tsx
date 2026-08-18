import React from 'react';
import ReactDOM from 'react-dom/client';
import { StarknetProvider } from './providers/StarknetProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import './index.css';

/**
 * The boundary sits inside the provider, not outside it.
 *
 * A wallet provider that fails to initialise is a different problem from a game screen that
 * throws while drawing, and putting the boundary inside means a provider failure is not
 * silently reported as a rendering bug.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StarknetProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StarknetProvider>
  </React.StrictMode>,
);
