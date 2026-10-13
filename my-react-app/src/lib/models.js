// Gemini models offered in the UI (Gemini 1.5 / 2.0 are shut down; 2.5 Flash is being retired in Oct 2026).
// The gateway maps any retired id to its default, so older saved selections keep working.
export const GEMINI_MODELS = [
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (fastest)', badge: 'Default' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (smartest)', badge: 'Deeper answers' },
];

export const DEFAULT_MODEL = GEMINI_MODELS[0].id;
