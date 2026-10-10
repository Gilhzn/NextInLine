import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Serves the exported web build of the mobile app from the same origin as the API (demo / preview mode).
 * Unknown paths fall back to index.html so client-side routes survive a reload.
 */
export async function webRoutes(app: FastifyInstance, webDir: string): Promise<void> {
  const root = path.resolve(webDir);
  const indexHtml = await readFile(path.join(root, "index.html"));

  app.get("/*", async (req, reply) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0] ?? "/");
    if (urlPath.startsWith("/v1/") || urlPath.startsWith("/admin/")) {
      return reply.code(404).send({ error: { code: "not_found", message: "לא נמצא" } });
    }
    const candidate = path.join(root, path.normalize(urlPath));
    if (candidate.startsWith(root + path.sep)) {
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile()) {
        const ext = path.extname(candidate).toLowerCase();
        return reply
          .header("Content-Type", TYPES[ext] ?? "application/octet-stream")
          .header("Cache-Control", urlPath.startsWith("/_expo/static/") ? "public, max-age=31536000, immutable" : "no-cache")
          .send(await readFile(candidate));
      }
    }
    return reply.header("Content-Type", TYPES[".html"]).header("Cache-Control", "no-cache").send(indexHtml);
  });
}
