import { defineConfig, loadEnv } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

export default defineConfig(({ mode }) => {
  // Determine the target network (e.g. "testnet", "mainnet") from VITE_NETWORK
  // or fall back to the Vite mode string.
  const baseEnv = loadEnv(mode, process.cwd(), "VITE_")
  const network = baseEnv.VITE_NETWORK ?? mode

  // Load network-specific env overrides from .env.{network}
  const networkEnv = loadEnv(network, process.cwd(), "VITE_")

  return {
    define: {
      "import.meta.env.VITE_NETWORK": JSON.stringify(network),
      ...Object.entries(networkEnv).reduce(
        (acc, [key, val]) => {
          acc[`import.meta.env.${key}`] = JSON.stringify(val)
          return acc
        },
        {} as Record<string, string>,
      ),
    },
    plugins: [
      nitro(),
      viteTsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
    ssr: {
      noExternal: ["react", "react-dom"],
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      deps: {
        inline: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "@testing-library/react",
          "@testing-library/user-event",
          "@testing-library/jest-dom",
        ],
      },
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
      },
    },
  }
})
