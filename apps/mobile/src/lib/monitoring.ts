import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Crash and error reporting. Off unless EXPO_PUBLIC_SENTRY_DSN is set at build time.
 * No screenshots, no view hierarchy, no touch/console breadcrumbs (they can contain names and medical details),
 * and request bodies are never attached.
 */
export function initMonitoring(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? "development" : "production"),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableUserInteractionTracing: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: (crumb) => (crumb.category === "console" || crumb.category === "touch" || crumb.category === "ui.click" ? null : crumb),
    beforeSend: (event) => {
      if (event.request) {
        delete event.request.data;
        delete event.request.headers;
        delete event.request.cookies;
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
      return event;
    },
  });
}

export const monitoringEnabled = !!dsn;
export const wrapRoot = <P extends Record<string, unknown>>(component: React.ComponentType<P>) =>
  dsn ? Sentry.wrap(component) : component;
