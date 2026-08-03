import { defineConfig } from "vitest/config";

const demoEntryPlugin = {
  name: "todex-demo-entry",
  transformIndexHtml: {
    order: "pre" as const,
    handler(html: string) {
      return {
        html: html
          .replace("<title>Todex Mock Demo Placeholder</title>", "<title>Todex Mock Demo</title>")
          .replace("<div>Mock Demo placeholder for Task 3.</div>", "<div id=\"root\"></div>"),
        tags: [{
          tag: "script",
          attrs: { type: "module", src: "/src/main.tsx" },
          injectTo: "body" as const,
        }],
      };
    },
  },
};

export default defineConfig({
  plugins: [demoEntryPlugin],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.spec.tsx"],
    environmentMatchGlobs: [["test/**/*.spec.tsx", "jsdom"]],
    setupFiles: ["./test/setup.ts"],
  },
});
