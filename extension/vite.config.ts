import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                popup: resolve(__dirname, "src/popup/index.html"),
                background: resolve(__dirname, "src/background/service-worker.ts"),
                observer: resolve(__dirname, "src/content-scripts/observer.ts"),
            },
            output: {
                entryFileNames: (chunk) => {
                    if (chunk.name === "background") return "background/service-worker.js";
                    if (chunk.name === "observer") return "content-scripts/observer.js";
                    return "assets/[name].js";
                },
                chunkFileNames: "assets/[name].js",
                assetFileNames: "assets/[name][extname]",
            },
        },
    },
});
