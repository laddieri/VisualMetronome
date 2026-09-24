import js from '@eslint/js';
import globals from 'globals';
import { p5Globals } from './eslint.p5-globals.mjs';

// Libraries the app loads with classic <script> tags (see index.html).
const libraryGlobals = {
  Tone: 'readonly',
  THREE: 'readonly',
  QRCode: 'readonly',
  Peer: 'readonly',
  p5: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/',
      'test-results/',
      'playwright-report/',
      // Vendored, minified libraries.
      'js/Tone.js',
      'js/tonejs-ui.js',
      // Disabled WebGPU demo (not loaded by index.html).
      'js/webgpu-ball.js',
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // Unused function arguments are common in event handlers/callbacks.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      // `catch (e) {}` is used deliberately to ignore storage/audio failures.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The var-style code re-declares loop counters (`for (var i …)`) in
      // sequential loops; let/const redeclarations are already syntax errors.
      'no-redeclare': 'off',
    },
  },
  {
    // App modules (p5 runs in global mode, so its API is global here).
    files: ['js/main.js', 'js/modules/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...libraryGlobals, ...p5Globals },
    },
  },
  {
    files: ['js/layout.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    files: ['server.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Test code evaluated inside the page.
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, Tone: 'readonly' } },
  },
];
