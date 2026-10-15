import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Webview SPA build -> out/webview/assets/index.js|css (providers reference these paths).
export default defineConfig({
  root: 'src/webview',
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../out/webview',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/main.tsx',
      output: {
        // deterministic names so provider html() can link them without manifest parsing
        entryFileNames: 'assets/index.js',
        assetFileNames: 'assets/index.[ext]',
      },
    },
  },
});
