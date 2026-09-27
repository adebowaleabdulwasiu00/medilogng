import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    strictPort: false,
    hmr: {
      host: 'localhost',
    },
  },
  preview: {
    port: 5174,
  },
  build: {
    outDir: 'dist',
    target: 'es2017',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) return 'vendor-firebase';
            return 'vendor';
          }
        }
      }
    }
  },
})
