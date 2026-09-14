import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // shared/ lives outside frontend/, and Vite refuses to serve files above the
      // project root unless told otherwise.
      allow: ['..'],
    },
  },
})
