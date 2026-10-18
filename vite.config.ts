import { defineConfig, loadEnv } from "vite";

// GitHub Pages project sites are served at /<repository>/.
const repository = process.env.VITE_GITHUB_REPOSITORY;
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required for a production build.");
  }
  return {
    base: repository ? `/${repository}/` : "/",
    // Public GitHub Pages deployments do not need to publish the full source.
    build: { outDir: "dist", sourcemap: false },
  };
});
