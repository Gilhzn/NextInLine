import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Deps } from "../context";
import { parse } from "../http";
import { MockPayments } from "../providers";
import { refreshCardSetup, verifyWebhookSignature } from "../services/payments";

export const page = (title: string, body: string) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#F8FAFC;color:#0F172A;margin:0;padding:24px;display:flex;justify-content:center}
main{max-width:420px;width:100%;background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:24px}
h1{font-size:22px;margin:0 0 8px}p{color:#475569;line-height:1.5}label{display:block;font-weight:600;margin:16px 0 6px}
input{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border:1.5px solid #CBD5E1;border-radius:12px;direction:ltr}
button,a.btn{display:block;width:100%;margin-top:20px;padding:14px;border:0;border-radius:12px;background:#0F766E;color:#fff;font-size:17px;font-weight:700;text-align:center;text-decoration:none}
.note{font-size:13px;background:#FEF3C7;border-radius:10px;padding:10px;color:#92400E}</style></head><body><main>${body}</main></body></html>`;

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Public origin of this server, for links handed to the payment provider. */
export function publicOrigin(deps: Deps, req: FastifyRequest): string {
  return deps.config.PUBLIC_BASE_URL || `${req.protocol}://${req.host}`;
}

export async function paymentRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  // Hosted pages and some providers' webhooks post HTML forms.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // The provider's hosted page sends the browser here; we send it back into the app.
  app.get<{ Params: { id: string }; Querystring: { platform?: string; to?: string; result?: string } }>(
    "/payments/return/:id",
    async (req, reply) => {
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      await refreshCardSetup(deps, id, { returnedWithFailure: req.query.result === "fail" }).catch(() => undefined);
      const native = req.query.platform === "native" && /^(magiali|exp|exps):\/\//.test(req.query.to ?? "");
      const target = native ? `${req.query.to}${req.query.to!.includes("?") ? "&" : "?"}setup=${id}` : `/payment-return?setup=${id}`;
      return reply
        .type("text/html")
        .header("Cache-Control", "no-store")
        .send(
          page(
            "חוזרים לאפליקציה",
            `<h1>רגע, חוזרים לאפליקציה…</h1><a class="btn" href="${escapeHtml(target)}">חזרה למגיע לי</a>
             <script>location.replace(${JSON.stringify(target)})</script>`,
          ),
        );
    },
  );

  // Provider → us. The body is never trusted: we ask the provider for the result ourselves.
  app.post<{ Params: { id: string }; Querystring: { sig?: string } }>("/payments/webhook/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    if (!verifyWebhookSignature(deps, id, req.query.sig ?? "")) return reply.code(403).send({ ok: false });
    await refreshCardSetup(deps, id);
    return { ok: true };
  });

  // Development stand-in for the provider's hosted card page.
  if (deps.payments instanceof MockPayments) {
    const mock = deps.payments;
    app.get<{ Params: { ref: string } }>("/payments/mock/:ref", async (req, reply) => {
      const ref = parse(z.string().regex(/^mock_[0-9a-f-]{36}$/), req.params.ref);
      return reply.type("text/html").send(
        page(
          "שמירת כרטיס",
          `<h1>שמירת כרטיס אשראי</h1><p>לא יבוצע חיוב עכשיו. העמלה תחויב רק אחרי שהכסף יגיע אליך.</p>
           <p class="note">🧪 סביבת הדגמה: זה דף סליקה מדומה. בייצור הכרטיס מוקלד בדף המאובטח של חברת הסליקה.</p>
           <form method="post" action="/payments/mock/${ref}">
             <label for="card">מספר כרטיס</label><input id="card" name="card" inputmode="numeric" autocomplete="off" placeholder="4580 0000 0000 0000" required>
             <button type="submit">שמירת הכרטיס</button>
           </form>`,
        ),
      );
    });
    app.post<{ Params: { ref: string }; Body: { card?: string } }>("/payments/mock/:ref", async (req, reply) => {
      const ref = parse(z.string().regex(/^mock_[0-9a-f-]{36}$/), req.params.ref);
      const next = mock.completeMockSetup(ref, String(req.body?.card ?? ""));
      if (!next) return reply.code(410).type("text/html").send(page("פג תוקף", "<h1>הדף פג תוקף</h1><p>חזור לאפליקציה ונסה שוב.</p>"));
      return reply.redirect(next.replace(/^https?:\/\/[^/]+/, ""), 303);
    });
  }
}
