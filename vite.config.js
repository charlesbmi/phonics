import { defineConfig } from 'vite';

// https://vite.dev/guide/static-deploy.html#github-pages
export default defineConfig({
  base: process.env.PAGES_BASE_PATH || './',
});
