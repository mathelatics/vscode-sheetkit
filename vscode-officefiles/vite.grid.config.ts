import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// OfficeFiles grid SPA build -> out/grid/assets/index.js|css (our own grid providers reference these).
// The rich reference viewers build to out/webview via ../vite.config.ts.
export default defineConfig({
  root: 'src/webview',
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../out/grid',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/main.tsx',
      output: {
        entryFileNames: 'assets/index.js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? assetInfo.names?.[0] ?? '';
          return name.endsWith('.css') ? 'assets/index.css' : 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
