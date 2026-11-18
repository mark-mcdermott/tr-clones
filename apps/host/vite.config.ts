import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { chosenMachine } from '../../scripts/machines.mjs';

// The drum machine this build is. Only its package is ever imported, and its
// page and what the page serves have a folder of their own.
const machine = chosenMachine();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '#machine': `@tr-clones/machine-${machine}` } },
  publicDir: `public/${machine}`,
  build: { outDir: `dist/${machine}`, emptyOutDir: true },
  // There is no server behind this page. The editor asks one for an account
  // and takes a plain "not found" as "no account", so a path that is not a
  // file must be answered that way, not with this page again.
  appType: 'mpa',
  server: { port: 4321, strictPort: true },
  preview: { port: 4322, strictPort: true },
});
