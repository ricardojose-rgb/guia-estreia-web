import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O site é servido em https://ricardojose-rgb.github.io/guia-estreia-web/
export default defineConfig({
  base: "./",
  plugins: [react()],
});
