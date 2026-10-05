import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  // This config lives in frontend/user; keep the app root, env files and build output here
  root: __dirname,
  // Env values are loaded from <repo>/Environment_Configs/frontend (.env.local)
  envDir: path.resolve(__dirname, '../../Environment_Configs/frontend'),
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app updates don't invalidate React/motion in the browser/SW cache
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\/]node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'vendor-react'
          if (/[\/]node_modules[\/](motion|framer-motion|motion-dom|motion-utils)[\/]/.test(id)) return 'vendor-motion'
          return undefined
        },
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
  server: {
    proxy: {
      '/admin': {
        target: 'http://localhost:8443',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
