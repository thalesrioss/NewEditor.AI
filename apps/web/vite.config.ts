import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// O servidor lê o `.env` da raiz do monorepo (--env-file-if-exists=../../.env);
// o proxy precisa ler o mesmo arquivo para falar com a mesma porta.
// Variável já exportada no ambiente (ex.: o app desktop) vence o arquivo.
const rootDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, 'NEWEDITOR_');
  const port = process.env.NEWEDITOR_PORT ?? env.NEWEDITOR_PORT ?? 4310;
  const target = `http://127.0.0.1:${port}`;

  return {
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
  };
});
