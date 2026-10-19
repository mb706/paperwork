import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({ plugins: [solid()], build: { rollupOptions: { input: { ui: 'ui.html', index: 'index.html' } } } });
