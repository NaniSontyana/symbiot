/**
 * Centralized backend URL resolution.
 *
 * Resolution order:
 *   1. Explicit env vars (VITE_GATEWAY_URL / VITE_ASR_URL) — electron:pack & custom deployments
 *   2. Electron desktop  -> localhost (services run on the same machine)
 *   3. Browser (dev or preview) -> same origin; the Vite dev server and the
 *      production static host proxy `/api` and `/ws/*` to the services,
 *      which keeps the frontend working when the browser is not the same
 *      machine as the services (e.g. hosted sandboxes).
 */

const env = import.meta.env || {};

export const isElectron =
  typeof window !== 'undefined' &&
  (!!window.electronAPI || (navigator.userAgent || '').includes('Electron'));

function wsProto() {
  return window.location.protocol === 'https:' ? 'wss:' : 'ws:';
}

/** HTTP base of the backend gateway ('' = same origin). */
export const GATEWAY_HTTP = env.VITE_GATEWAY_URL || (isElectron ? 'http://localhost:5000' : '');

/** WebSocket base of the backend gateway */
export const GATEWAY_WS =
  env.VITE_GATEWAY_URL
    ? env.VITE_GATEWAY_URL.replace(/^http/, 'ws')
    : isElectron
      ? 'ws://localhost:5000'
      : `${wsProto()}${window.location.host}`;

/** Full URL of the copilot streaming WebSocket */
export function copilotWsUrl() {
  return `${GATEWAY_WS}/ws/copilot`;
}

/** Full URL of the ASR transcription WebSocket */
export function asrWsUrl() {
  if (env.VITE_ASR_URL) {
    return `${env.VITE_ASR_URL.replace(/^http/, 'ws')}/ws/transcribe`;
  }
  // The Vite dev server proxies /ws/asr-transcribe -> localhost:8000/ws/transcribe
  return isElectron
    ? 'ws://localhost:8000/ws/transcribe'
    : `${wsProto()}${window.location.host}/ws/asr-transcribe`;
}

/** Prefix helper for gateway REST calls */
export function apiUrl(path) {
  return `${GATEWAY_HTTP}${path}`;
}
