import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function fixSignalRPureAnnotations() {
  return {
    name: 'fix-signalr-pure-annotations',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (
        !id.includes('/@microsoft/signalr/dist/esm/Utils.js') &&
        !id.includes('\\@microsoft\\signalr\\dist\\esm\\Utils.js')
      ) {
        return null
      }

      const nextCode = code.replace(/\/\*#__PURE__\*\/\s+function\s+/g, 'function ')

      if (nextCode === code) {
        return null
      }

      return {
        code: nextCode,
        map: null,
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [fixSignalRPureAnnotations(), react()],
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
})
