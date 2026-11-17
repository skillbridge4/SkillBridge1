import { defineConfig, loadEnv } from 'vite';
import { getDevConfig, loadDevEnvironment } from './scripts/dev-config.mjs';

export default defineConfig(({ mode }) => {
  loadDevEnvironment();
  const environment = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const config = getDevConfig(environment);

  return {
    envDir: 'client',
    plugins: [{
      name: 'protect-learning-path-answer-key',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname === '/data/seed/paths.json') {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (new URL(request.url, 'http://localhost').pathname === '/data/seed/paths.json') {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }
          next();
        });
      }
    }],
    server: {
      host: config.webHost,
      port: config.webPort,
      strictPort: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
      },
      proxy: {
        '/api': {
          target: config.apiProxyTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'esnext'
    }
  };
});
