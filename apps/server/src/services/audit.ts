import type { Db } from "../db";

export interface AuditEntry {
  actorUserId?: string | null;
  actorKind: "user" | "system" | "ops";
  action: string;
  entity: string;
  entityId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

/** Append-only trail of access to sensitive data and of state changes. Never store PII in meta. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db`
    INSERT INTO audit_log (actor_user_id, actor_kind, action, entity, entity_id, ip, meta)
    VALUES (${e.actorUserId ?? null}, ${e.actorKind}, ${e.action}, ${e.entity}, ${e.entityId ?? null},
            ${e.ip ?? null}, ${e.meta ? db.json(e.meta as never) : null})`;
}
