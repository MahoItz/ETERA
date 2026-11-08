import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required for a production build.");
  }
  return {
    // The custom domain elveria.ru serves the site from the domain root.
    base: "/",
    // Public GitHub Pages deployments do not need to publish the full source.
    build: { outDir: "dist", sourcemap: false },
  };
});
