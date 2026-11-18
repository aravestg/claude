import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Base configurable para despliegues en subrutas (p.ej. GitHub Pages: /<repo>/).
export default defineConfig({
  base: process.env.ASA_BASE_PATH ?? '/',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei'], react: ['react', 'react-dom'] }
      }
    }
  },
  server: { port: 5173 },
  preview: { port: 4173 }
});
