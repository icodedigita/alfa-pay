import { defineConfig } from "tsup";

export default defineConfig([
  // Browser part: must be a client module in Next.js
  { entry: { index: "src/index.ts" }, format: ["esm", "cjs"], dts: true, external: ["react"], banner: { js: '"use client";' }, clean: true },
  // Server part
  { entry: { server: "src/server.ts" }, format: ["esm", "cjs"], dts: true },
]);
