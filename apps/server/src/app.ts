import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Deps } from "./context";
import { AppError } from "./errors";
import { captureError } from "./monitoring";
import { adminRoutes } from "./routes/admin";
import { opsRoutes } from "./routes/ops";
import { publicRoutes } from "./routes/public";
import { userRoutes } from "./routes/user";
import { webRoutes } from "./routes/web";
import "./services/register";

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          redact: ["req.headers.authorization", "req.headers['x-admin-token']", "req.body.phone", "req.body.code"],
        }
      : false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } });
  await app.register(cors, {
    // Native apps don't use CORS; this serves the web preview build in development.
    origin: deps.config.NODE_ENV === "production" ? false : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart);

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: "rate_limited", message: "יותר מדי בקשות. נסה שוב בעוד רגע" } });
    }
    if (err.code === "FST_REQ_FILE_TOO_LARGE" || err.statusCode === 413) {
      return reply.code(413).send({ error: { code: "payload_too_large", message: "הקובץ גדול מדי" } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: "validation_error", message: err.message ?? "בקשה לא תקינה" } });
    }
    req.log.error(error);
    captureError(error, { userId: req.auth?.userId, tags: { route: req.routeOptions.url ?? "unknown" } });
    return reply.code(500).send({ error: { code: "internal", message: "משהו השתבש. נסה שוב" } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "לא נמצא" } }));

  await app.register(async (scope) => publicRoutes(scope, deps));
  await app.register(async (scope) => userRoutes(scope, deps), { prefix: "/v1" });
  await app.register(async (scope) => adminRoutes(scope, deps), { prefix: "/admin" });
  await app.register(async (scope) => opsRoutes(scope));
  if (deps.config.WEB_DIR) {
    const webDir = deps.config.WEB_DIR;
    await app.register(async (scope) => webRoutes(scope, webDir));
  }

  return app;
}
