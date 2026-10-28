import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const publicPage = fileURLToPath(new URL('./index.html', import.meta.url));
const adminPage = fileURLToPath(new URL('./admin/index.html', import.meta.url));
const servicePage = fileURLToPath(new URL('./servicios/index.html', import.meta.url));
const ratesPage = fileURLToPath(new URL('./tarifas/index.html', import.meta.url));
const tournamentsPage = fileURLToPath(new URL('./torneos/index.html', import.meta.url));
const newsPage = fileURLToPath(new URL('./noticias/index.html', import.meta.url));
const bookingPage = fileURLToPath(new URL('./reservar/index.html', import.meta.url));
const venuePage = fileURLToPath(new URL('./local/index.html', import.meta.url));
const communityPage = fileURLToPath(new URL('./comunidad/index.html', import.meta.url));

export default defineConfig({
  root: 'client',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        public: publicPage,
        admin: adminPage,
        services: servicePage,
        rates: ratesPage,
        tournaments: tournamentsPage,
        news: newsPage,
        booking: bookingPage,
        venue: venuePage,
        community: communityPage,
      },
    },
  },
});