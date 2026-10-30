import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) return 'charts';
          if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/') || id.includes('/node_modules/react-router')) return 'react-vendor';
        },
      },
    },
  },
});
