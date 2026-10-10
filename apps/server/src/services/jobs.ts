import { hostname } from "node:os";
import type { Deps } from "../context";
import type { Db } from "../db";

export type JobType =
  | "extract_receipt"
  | "submit_leg"
  | "charge_fee"
  | "send_notification"
  | "remind_missing_docs"
  | "purge_deleted_user";

export type JobHandler = (deps: Deps, payload: Record<string, unknown>, job: { id: number; attempts: number }) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

/** A failure that should not be retried (bad data, missing record). */
export class PermanentJobError extends Error {}

export async function enqueue(
  db: Db,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Promise<void> {
  await db`
    INSERT INTO jobs (type, payload, run_at, max_attempts)
    VALUES (${type}, ${db.json(payload as never)}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 3})`;
}

const CHARGE_BACKOFF_DAYS = [1, 3, 7];

export function backoffMs(type: string, attempts: number): number {
  if (type === "charge_fee") return (CHARGE_BACKOFF_DAYS[attempts - 1] ?? 7) * 86_400_000;
  return Math.min(2 ** attempts * 30_000, 6 * 3_600_000);
}

type JobRow = { id: number; type: JobType; payload: Record<string, unknown>; attempts: number; maxAttempts: number };

/**
 * Claims due jobs with SKIP LOCKED (safe with many workers), runs them, and records the outcome.
 * Handlers must be idempotent: a crash after the side effect but before `done_at` means a re-run.
 */
export async function runDueJobs(deps: Deps, opts: { limit?: number; workerId?: string } = {}): Promise<number> {
  const now = deps.now();
  const workerId = opts.workerId ?? `${hostname()}:${process.pid}`;
  const staleLock = new Date(now.getTime() - 5 * 60_000);

  const jobs = (await deps.sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, type, payload, attempts, max_attempts FROM jobs
      WHERE done_at IS NULL AND failed_at IS NULL AND run_at <= ${now}
        AND (locked_at IS NULL OR locked_at < ${staleLock})
      ORDER BY run_at
      LIMIT ${opts.limit ?? 20}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length > 0) {
      await tx`UPDATE jobs SET locked_at = ${now}, locked_by = ${workerId} WHERE id IN ${tx(rows.map((r) => r.id as number))}`;
    }
    return rows;
  })) as unknown as JobRow[];

  for (const job of jobs) {
    const handler = handlers.get(job.type);
    const attempts = job.attempts + 1;
    try {
      if (!handler) throw new PermanentJobError(`no handler for job type ${job.type}`);
      await handler(deps, job.payload, { id: job.id, attempts });
      await deps.sql`UPDATE jobs SET done_at = ${deps.now()}, attempts = ${attempts}, locked_at = NULL WHERE id = ${job.id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof PermanentJobError || attempts >= job.maxAttempts;
      const nextRun = new Date(deps.now().getTime() + backoffMs(job.type, attempts));
      await deps.sql`
        UPDATE jobs SET attempts = ${attempts}, last_error = ${message.slice(0, 1000)}, locked_at = NULL,
               run_at = ${permanent ? deps.now() : nextRun}, failed_at = ${permanent ? deps.now() : null}
        WHERE id = ${job.id}`;
      if (permanent) await onJobFailedPermanently(deps, job, message);
    }
  }
  return jobs.length;
}

const failureHooks = new Map<JobType, (deps: Deps, payload: Record<string, unknown>, error: string) => Promise<void>>();

export function registerJobFailureHook(
  type: JobType,
  hook: (deps: Deps, payload: Record<string, unknown>, error: string) => Promise<void>,
): void {
  failureHooks.set(type, hook);
}

async function onJobFailedPermanently(deps: Deps, job: JobRow, error: string): Promise<void> {
  const hook = failureHooks.get(job.type);
  if (hook) await hook(deps, job.payload, error);
}

export function startWorker(deps: Deps): { stop: () => Promise<void> } {
  let running = true;
  let current: Promise<unknown> = Promise.resolve();
  const tick = async () => {
    while (running) {
      try {
        const n = await runDueJobs(deps);
        if (n === 0) await new Promise((r) => setTimeout(r, deps.config.WORKER_POLL_MS));
      } catch (error) {
        console.error("worker tick failed", error);
        await new Promise((r) => setTimeout(r, deps.config.WORKER_POLL_MS));
      }
    }
  };
  current = tick();
  return {
    stop: async () => {
      running = false;
      await current;
    },
  };
}
