import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { branding } from "./src/branding";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["branding/favicon.svg"],
      devOptions: { enabled: true },
      manifest: {
        name: branding.appName,
        short_name: branding.shortName,
        description: "Recreational darts league management",
        theme_color: branding.themeColor,
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: branding.faviconSrc,
            sizes: "any",
            type: "image/svg+xml",
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    exclude: [...configDefaults.exclude, "api/**"],
  },
});
