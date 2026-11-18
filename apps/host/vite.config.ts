import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // There is no server behind this page. The editor asks one for an account
  // and takes a plain "not found" as "no account", so a path that is not a
  // file must be answered that way, not with this page again.
  appType: 'mpa',
  server: { port: 4321, strictPort: true },
  preview: { port: 4322, strictPort: true },
});
