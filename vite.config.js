import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              external: ['puppeteer', 'bufferutil', 'utf-8-validate']
            },
            // Don't bundle src/ folder, keep it as-is for require()
            copyPublicDir: false
          }
        }
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.js'),
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './renderer/src'),
      'vue': 'vue/dist/vue.esm-bundler.js',
    },
  },
  optimizeDeps: {
    exclude: ['puppeteer', 'bufferutil', 'utf-8-validate']
  }
})

