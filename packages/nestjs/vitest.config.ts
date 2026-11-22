import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC emits the decorator metadata NestJS reads; esbuild (vitest's default) does not.
export default defineConfig({ plugins: [swc.vite({ module: { type: "es6" } })] });
