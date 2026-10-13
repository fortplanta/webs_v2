import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Excalidraw font folders whose files are replaced by one of ours (see below). The file names are what Excalidraw asks for. */
const exFonts = (dir: string) => readdirSync(resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts', dir));
const KEPT = readdirSync(resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')).filter(d => !['Liberation', 'Nunito', 'Cascadia', 'ComicShanns', 'Lilita'].includes(d));
const RESKINNED = [
  { dir: 'Liberation', font: 'NeueMontreal-Regular.ttf', files: exFonts('Liberation') },
  { dir: 'Nunito', font: 'NeueMontreal-Medium.ttf', files: exFonts('Nunito') },
  { dir: 'Cascadia', font: 'NeueMontreal-Bold.ttf', files: exFonts('Cascadia') },
  { dir: 'ComicShanns', font: 'NeueMontreal-Light.ttf', files: exFonts('ComicShanns') },
  { dir: 'Lilita', font: 'DentonCondensedTest-Thin.otf', files: exFonts('Lilita') },
];

/** Serves (dev) and emits (build) our font files under the paths Excalidraw loads its own fonts from. */
function reskinFonts(): Plugin {
  const files = new Map<string, string>();
  for (const r of RESKINNED) for (const f of r.files) files.set(`excalidraw-assets/fonts/${r.dir}/${f}`, resolve('assets/fonts', r.font));
  return {
    name: 'reskin-excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.get(decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, ''));
        if (!file) return next();
        res.setHeader('Content-Type', 'font/ttf');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, file] of files) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
    },
  };
}

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
      //
      // Excalidraw can only draw text in its own built-in families, so five of them are *re-skinned*: the files it loads
      // for that family are replaced by ours. In the canvas, family N therefore renders as:
      //   2 (Helvetica/Liberation) → Neue Montreal Regular     6 (Nunito)      → Neue Montreal Medium
      //   3 (Cascadia)             → Neue Montreal Bold        8 (Comic Shanns) → Neue Montreal Light
      //   7 (Lilita One)           → Denton Condensed Thin
      // (See FONT in src/renderer/boxes.ts for the names the code uses.)
      reskinFonts(),
      viteStaticCopy({
        targets: [
          {
            // everything except the families we replace (a dev server serves the *first* match, so no duplicates)
            src: KEPT.map(d => resolve(`node_modules/@excalidraw/excalidraw/dist/prod/fonts/${d}/**/*`)),
            dest: 'excalidraw-assets/fonts',
            rename: { stripBase: 6 },
          },
        ],
      }),
    ],
  },
});
