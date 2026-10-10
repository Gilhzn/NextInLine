import * as Sentry from "@sentry/node";
import type { Config } from "./config";

let enabled = false;

/**
 * Error monitoring (Sentry). Off unless SENTRY_DSN is set.
 * Medical and personal data must never leave the server: request bodies, query strings, headers,
 * cookies and log breadcrumbs are dropped, and the user is identified by id only.
 */
export function initMonitoring(config: Config): void {
  if (!config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    release: config.RELEASE,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: (crumb) => (crumb.category === "console" || crumb.category === "http" ? null : crumb),
  });
  enabled = true;
}

export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.headers;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  delete event.extra;
  return event;
}

export function captureError(error: unknown, context?: { userId?: string; tags?: Record<string, string> }): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context?.userId) scope.setUser({ id: context.userId });
    for (const [k, v] of Object.entries(context?.tags ?? {})) scope.setTag(k, v);
    Sentry.captureException(error);
  });
}

export async function flushMonitoring(): Promise<void> {
  if (enabled) await Sentry.flush(2000);
}
