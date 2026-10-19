import { readFileSync } from "node:fs";
import { optimizerBuildDefines } from "./scripts/lib/optimizer-build";
import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  define: optimizerBuildDefines,
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: "dev-annotation-tutorial",
      configureServer(server) {
        server.middlewares.use("/__repro-test", async (_request, response, next) => {
          try { const html = await server.transformIndexHtml('/__repro-test', readFileSync(new URL('./src/dev/repro-test.html', import.meta.url), 'utf8')); response.setHeader('Content-Type', 'text/html'); response.end(html) } catch (error) { next(error) }
        });
        server.middlewares.use("/annotation-tutorial", async (_request, response, next) => {
          try {
            const html = await server.transformIndexHtml(
              "/annotation-tutorial",
              readFileSync(
                new URL("./src/tutorials/annotation-tutorial.html", import.meta.url),
                "utf8",
              ),
            );
            response.setHeader("Content-Type", "text/html");
            response.end(
              html.replace(
                "</body>",
                '<script type="module" src="/src/dev/edit-mode.tsx"></script></body>',
              ),
            );
          } catch (error) {
            next(error);
          }
        });
      },
    },
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
});
