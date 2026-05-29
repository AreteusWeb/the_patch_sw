// import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

/**
 * Mount and render the root React application into the DOM container.
 */
createRoot(document.getElementById('root')!).render(
  // Removed React.StrictMode temporarily to prevent 'doubleInvokeEffectsInDEV'
  // which duplicates effects (like WebSocket connections) during development.
  // <StrictMode>
    <App />
  // </StrictMode>,
);
