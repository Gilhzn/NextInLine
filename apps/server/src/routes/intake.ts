import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../context";
import { parse } from "../http";
import { MOCK_INSTITUTIONS, MockOpenBanking } from "../open-banking";
import { inboundAuthorized, inboundEmailSchema, receiveInboundEmail } from "../services/inbox";
import { refreshBankConnection } from "../services/open-banking";
import { escapeHtml, page } from "./payments";

/** Ways money information flows in from outside: forwarded receipt emails and open banking consents. */
export async function intakeRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  // The demo consent page posts an HTML form; repeated fields (several institutions) become arrays.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of new URLSearchParams(body as string)) {
      const prev = out[k];
      out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
    }
    done(null, out);
  });

  // The inbound email provider posts each message here (attachments base64 – hence the larger body limit).
  app.post("/webhooks/inbound-email", { bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
    if (!deps.config.INBOUND_EMAIL_DOMAIN) return reply.code(404).send({ ok: false });
    if (!inboundAuthorized(deps, req.headers)) return reply.code(401).send({ ok: false });
    const email = inboundEmailSchema.safeParse(req.body);
    if (!email.success) return reply.code(400).send({ ok: false });
    // Always 200 once authenticated, so the provider doesn't retry an email we deliberately dropped.
    return { ok: true, ...(await receiveInboundEmail(deps, email.data)) };
  });

  // The provider's consent page sends the browser here; we send it back into the app.
  app.get<{ Params: { id: string }; Querystring: { platform?: string; to?: string } }>("/open-banking/return/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await refreshBankConnection(deps, id).catch(() => undefined);
    const native = req.query.platform === "native" && /^(magiali|exp|exps):\/\//.test(req.query.to ?? "");
    const target = native ? `${req.query.to}${req.query.to!.includes("?") ? "&" : "?"}connection=${id}` : `/bank-return?connection=${id}`;
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
  });

  // Development stand-in for a licensed provider's consent page.
  if (deps.openBanking instanceof MockOpenBanking) {
    const mock = deps.openBanking;
    const refParam = z.string().regex(/^mockob_[0-9a-f-]{36}$/);
    app.get<{ Params: { ref: string } }>("/open-banking/mock/:ref", async (req, reply) => {
      const ref = parse(refParam, req.params.ref);
      const boxes = MOCK_INSTITUTIONS.map(
        (name, i) =>
          `<label style="font-weight:500;display:flex;gap:8px;align-items:center"><input type="checkbox" name="i" value="${escapeHtml(name)}" ${i < 2 ? "checked" : ""} style="width:auto">${escapeHtml(name)}</label>`,
      ).join("");
      return reply.type("text/html").send(
        page(
          "אישור גישה למידע",
          `<h1>אישור גישה לקריאת תשלומים</h1>
           <p>"מגיע לי" מבקשת לקרוא (בלבד) את העסקאות בחשבונות ובכרטיסים שתבחר/י, למשך שנה. אפשר לבטל בכל רגע.</p>
           <p class="note">🧪 סביבת הדגמה: זה דף הסכמה מדומה. בייצור ההסכמה ניתנת אצל נותן שירות מידע פיננסי מורשה, עם הזדהות מול הבנק.</p>
           <form method="post" action="/open-banking/mock/${ref}">${boxes}
             <button type="submit" name="decision" value="approve">אישור</button>
             <button type="submit" name="decision" value="decline" style="background:#E2E8F0;color:#0F172A">לא עכשיו</button>
           </form>`,
        ),
      );
    });
    app.post<{ Params: { ref: string }; Body: { decision?: string; i?: string | string[] } }>("/open-banking/mock/:ref", async (req, reply) => {
      const ref = parse(refParam, req.params.ref);
      const picked = req.body?.i === undefined ? [] : Array.isArray(req.body.i) ? req.body.i : [req.body.i];
      const next = mock.complete(ref, req.body?.decision === "approve" ? picked : null);
      if (!next) return reply.code(410).type("text/html").send(page("פג תוקף", "<h1>הדף פג תוקף</h1><p>חזור לאפליקציה ונסה שוב.</p>"));
      return reply.redirect(next.replace(/^https?:\/\/[^/]+/, ""), 303);
    });
  }
}
