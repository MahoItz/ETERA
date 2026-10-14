import { defineConfig } from "vite";

// GitHub Pages project sites are served at /<repository>/.
const repository = process.env.VITE_GITHUB_REPOSITORY;
export default defineConfig({
  base: repository ? `/${repository}/` : "/",
  build: { outDir: "dist", sourcemap: true },
});
