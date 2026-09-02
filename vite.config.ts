import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Manual prompt via useRegisterSW — never silent auto-reload.
        registerType: 'prompt',
        includeAssets: ['favicon.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'Areteus The Patch',
          short_name: 'The Patch',
          description: 'Areteus The Patch — live vitals and AI coach',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/apple-touch-icon.png',
              sizes: '180x180',
              type: 'image/png',
            },
            {
              src: '/favicon.png',
              sizes: '32x32',
              type: 'image/png',
            },
          ],
        },
        workbox: {
          // Needed so skipWaiting actually takes control of open tabs (reload path).
          clientsClaim: true,
          navigateFallbackDenylist: [/^\/api/, /^\/ws/],
          runtimeCaching: [
            {
              urlPattern: ({url}) => url.pathname.startsWith('/api/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 10,
              },
            },
          ],
        },
        // SW is off in `npm run dev` — use build + preview to test updates.
        devOptions: {
          enabled: false,
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Allows opening the app from the local network IP (e.g. your phone on
      // the same WiFi) without the HMR WebSocket failing with a 400 handshake.
      host: true,
    },
  };
});