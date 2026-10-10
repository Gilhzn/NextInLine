import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { AppError } from "./errors";
import type { AuthContext } from "./context";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      "validation_error",
      "הנתונים שנשלחו אינם תקינים",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError("unauthorized", "נדרשת התחברות");
  return req.auth;
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : d;
