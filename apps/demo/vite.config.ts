import { defineConfig } from 'vite';
import { converterPages } from './src/site/plugin';

export default defineConfig({
  plugins: [converterPages()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  worker: {
    format: 'es',
  },
});
