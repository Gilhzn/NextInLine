import type { FastifyInstance } from "fastify";
import { otpRequestSchema, otpVerifySchema, refreshSchema } from "@magiali/shared";
import type { Deps } from "../context";
import { hmacHex, safeEqualHex } from "../crypto";
import { AppError } from "../errors";
import { parse } from "../http";
import { audit } from "../services/audit";
import { logout, refreshTokens, requestLoginOtp, verifyLoginOtp } from "../services/auth";
import { readDocument } from "../services/receipts";

export async function publicRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get("/health", async () => {
    await deps.sql`SELECT 1`;
    return { ok: true, version: process.env.npm_package_version ?? "dev" };
  });

  const otpLimit = { config: { rateLimit: { max: deps.config.OTP_ROUTE_LIMIT_PER_10MIN, timeWindow: "10 minutes" } } };

  app.post("/v1/auth/otp/request", otpLimit, async (req, reply) => {
    const { phone } = parse(otpRequestSchema, req.body);
    await requestLoginOtp(deps, phone, req.ip);
    return reply.code(204).send();
  });

  app.post("/v1/auth/otp/verify", otpLimit, async (req) => {
    const { phone, code } = parse(otpVerifySchema, req.body);
    return verifyLoginOtp(deps, phone, code, req.ip);
  });

  app.post("/v1/auth/refresh", async (req) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    return refreshTokens(deps, refreshToken);
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    await logout(deps, refreshToken);
    return reply.code(204).send();
  });

  // Short-lived signed URLs so <Image> components can load receipts without auth headers.
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>("/v1/files/:id", async (req, reply) => {
    const { id } = req.params;
    const exp = Number(req.query.exp);
    const sig = req.query.sig ?? "";
    if (!Number.isFinite(exp) || exp * 1000 < deps.now().getTime() || !/^[0-9a-f]{64}$/.test(sig)) {
      throw new AppError("forbidden", "הקישור פג תוקף");
    }
    if (!safeEqualHex(sig, hmacHex(deps.config.FILES_SIGNING_SECRET, `${id}:${exp}`))) {
      throw new AppError("forbidden", "הקישור אינו תקין");
    }
    const file = await readDocument(deps, id);
    await audit(deps.sql, { actorKind: "user", action: "file_read", entity: "document", entityId: id, ip: req.ip });
    return reply
      .header("Content-Type", file.mimeType)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(file.data);
  });
}
