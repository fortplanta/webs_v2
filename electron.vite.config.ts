import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [
      react(),
      // Excalidraw's fonts, served locally (see src/renderer/public/asset-path.js). stripBase removes the six leading
      // path segments so files land at excalidraw-assets/fonts/<Family>/<file>.
      viteStaticCopy({
        targets: [{ src: resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*'), dest: 'excalidraw-assets/fonts', rename: { stripBase: 6 } }],
      }),
    ],
  },
});
