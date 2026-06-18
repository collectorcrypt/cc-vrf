import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // A few Solana / wallet-adapter deps reach for `global` and
    // `process.env`; shim them so the browser bundle stays quiet.
    global: "globalThis",
    "process.env": {},
  },
  optimizeDeps: {
    // The workspace packages compile to CommonJS, so dev mode (which serves
    // ESM directly) can't named-import from them. Forcing them through
    // esbuild's pre-bundling converts them to ESM with named exports.
    include: [
      "@collectorcrypt/ecvrf",
      "@collectorcrypt/vrf-client",
      "@solana/web3.js",
      "@coral-xyz/anchor",
      "@lightprotocol/stateless.js",
      "buffer",
    ],
  },
});
