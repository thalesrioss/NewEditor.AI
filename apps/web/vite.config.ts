import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = `http://127.0.0.1:${process.env.NEWEDITOR_PORT ?? 4310}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/media': target,
      '/refs': target,
      '/ws': { target, ws: true },
    },
  },
});
