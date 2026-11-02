import './tokens.css';
import './home.css';
import './drive.css';
import { setTurnServers } from '@watchlink/core';
import { render } from 'preact';
import { App } from './App.js';
import { Splash } from './components/Splash.js';

export { App };

// Optional TURN relay for mobile networks: build-time env or a saved JSON list.
try {
  const raw = localStorage.getItem('watchlink:turn') || import.meta.env.VITE_WATCHLINK_TURN;
  if (raw) setTurnServers(JSON.parse(raw));
} catch {}

document.documentElement.classList.add('splash-active');
const root = document.getElementById('app');
if (root) {
  render(
    <>
      <App />
      <Splash />
    </>,
    root,
  );
}
