import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { marked } from "marked";
import { FEE_POLICY, LEGAL_VERSIONS } from "@magiali/shared";
import type { Deps } from "../context";
import { publicOrigin } from "./payments";

// apps/server/legal – one level up from dist/ (bundled) or two from src/routes/ (development).
const here = path.dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = [path.resolve(here, "../legal"), path.resolve(here, "../../legal")].find((d) => existsSync(path.join(d, "terms.md")))!;
const DOCS = { terms: "terms.md", privacy: "privacy.md", poa: "poa.md", accessibility: "accessibility.md" } as const;

const MISSING = (what: string) => `[להשלים: ${what}]`;

const shell = (title: string, body: string) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · מגיע לי</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#F8FAFC;color:#0F172A;margin:0;line-height:1.65}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;color:#0F766E}h2{font-size:19px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{border:1px solid #E2E8F0;padding:8px;text-align:right;vertical-align:top}
th{background:#E6F4F1}a{color:#0F766E}blockquote{margin:16px 0;padding:10px 14px;background:#FEF3C7;border-radius:10px}
nav{font-size:14px;margin-bottom:12px}nav a{margin-left:12px}input,button{font-size:17px;padding:12px;border-radius:12px;border:1.5px solid #CBD5E1;width:100%;box-sizing:border-box;margin-top:8px}
button{background:#B91C1C;color:#fff;border:0;font-weight:700}button.secondary{background:#0F766E}#msg{margin-top:12px;font-weight:600}</style></head>
<body><main><nav><a href="/legal/terms">תנאי שימוש</a><a href="/legal/privacy">פרטיות</a><a href="/legal/poa">ייפוי כוח</a><a href="/legal/accessibility">נגישות</a></nav>${body}</main></body></html>`;

function values(deps: Deps, origin: string): Record<string, string> {
  const c = deps.config;
  return {
    TERMS_VERSION: LEGAL_VERSIONS.terms,
    PRIVACY_VERSION: LEGAL_VERSIONS.privacy,
    POA_VERSION: LEGAL_VERSIONS.poa,
    LEGAL_ENTITY_NAME: c.LEGAL_ENTITY_NAME ?? MISSING("שם החברה"),
    LEGAL_ENTITY_ID: c.LEGAL_ENTITY_ID ? `ח.פ./ע.מ. ${c.LEGAL_ENTITY_ID}` : MISSING("ח.פ. או ע.מ."),
    LEGAL_ADDRESS: c.LEGAL_ADDRESS ?? MISSING("כתובת"),
    CONTACT_EMAIL: c.CONTACT_EMAIL ?? MISSING("דוא״ל לפניות"),
    DPO_NAME: c.DPO_NAME ?? MISSING("שם הממונה על הגנת הפרטיות"),
    DPO_EMAIL: c.DPO_EMAIL ?? MISSING("דוא״ל הממונה"),
    ACCESSIBILITY_CONTACT: c.ACCESSIBILITY_CONTACT ?? c.CONTACT_EMAIL ?? MISSING("פרטי רכז הנגישות"),
    PUBLIC_URL: origin,
    FEE_STANDARD: String(FEE_POLICY.standardRateBps / 100),
    FEE_RETRO: String(FEE_POLICY.retroRateBps / 100),
    FEE_CAP: String(FEE_POLICY.capAgorot / 100),
    FEE_DELAY_DAYS: String(FEE_POLICY.chargeDelayDays),
    RETENTION_DAYS: String(c.RECEIPT_RETENTION_DAYS),
    HOSTING_PROVIDERS: c.S3_BUCKET ? "Render, Cloudflare R2" : "Render",
    HOSTING_REGION: "האיחוד האירופי (גרמניה)",
    SMS_PROVIDER: c.TWILIO_ACCOUNT_SID ? "Twilio" : "ספק SMS",
    SMS_REGION: c.TWILIO_ACCOUNT_SID ? "ארה״ב" : "—",
    EMAIL_PROVIDER: c.RESEND_API_KEY ? "Resend" : "ספק דוא״ל",
    SENTRY_REGION: c.SENTRY_DSN?.includes(".de.sentry.io") ? "האיחוד האירופי" : "ארה״ב",
    INBOUND_EMAIL_PROVIDER: "Postmark",
    INBOUND_EMAIL_REGION: "ארה״ב",
  };
}

export function renderLegal(deps: Deps, doc: keyof typeof DOCS, origin: string): string {
  const v = values(deps, origin);
  const md = readFileSync(path.join(LEGAL_DIR, DOCS[doc]), "utf8").replace(/\{\{(\w+)\}\}/g, (_m, k: string) => v[k] ?? MISSING(k));
  return marked.parse(md, { async: false });
}

const DELETE_PAGE = `<h1>מחיקת חשבון</h1>
<p>אפשר למחוק את החשבון גם מתוך האפליקציה (הגדרות ← מחיקת החשבון). כאן אפשר למחוק אותו מהדפדפן: מזינים את מספר הנייד, מקבלים קוד ב-SMS, ומאשרים.</p>
<p>מה נמחק: כל המידע, הקבלות והמסמכים. תביעות פתוחות יבוטלו. החשבון נחסם מיד, והקבצים נמחקים לצמיתות תוך 30 יום. מסמכי מס על עמלות שנגבו נשמרים לתקופה שהדין מחייב.</p>
<label for="phone">מספר נייד</label><input id="phone" inputmode="tel" placeholder="050-0000000">
<button class="secondary" id="send">שלחו לי קוד</button>
<div id="step2" hidden><label for="code">קוד מה-SMS</label><input id="code" inputmode="numeric" maxlength="6">
<button id="del">מחיקת החשבון לצמיתות</button></div><div id="msg" role="status"></div>
<script>
const $=(id)=>document.getElementById(id);const say=(t)=>{$("msg").textContent=t};
async function call(method,path,body,token){const r=await fetch(path,{method,headers:{...(body?{"content-type":"application/json"}:{}),...(token?{authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});
const t=await r.text();const d=t?JSON.parse(t):null;if(!r.ok)throw new Error(d&&d.error?d.error.message:"שגיאה");return d}
$("send").onclick=async()=>{try{await call("POST","/v1/auth/otp/request",{phone:$("phone").value});$("step2").hidden=false;say("שלחנו קוד")}catch(e){say(e.message)}};
$("del").onclick=async()=>{if(!confirm("למחוק את החשבון לצמיתות?"))return;try{const s=await call("POST","/v1/auth/otp/verify",{phone:$("phone").value,code:$("code").value});
await call("DELETE","/v1/me",null,s.accessToken);say("החשבון נמחק.");$("step2").hidden=true}catch(e){say(e.message)}};
</script>`;

export async function legalRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const titles = { terms: "תנאי שימוש", privacy: "מדיניות פרטיות", poa: "ייפוי כוח", accessibility: "הצהרת נגישות" } as const;

  for (const doc of Object.keys(DOCS) as Array<keyof typeof DOCS>) {
    app.get(`/legal/${doc}`, async (req, reply) => {
      const html = shell(titles[doc], renderLegal(deps, doc, publicOrigin(deps, req)));
      return reply.type("text/html; charset=utf-8").header("Cache-Control", "public, max-age=300").send(html);
    });
  }
  app.get("/legal/delete-account", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(shell("מחיקת חשבון", DELETE_PAGE)),
  );
  app.get("/v1/legal", async (req) => {
    const origin = publicOrigin(deps, req);
    return {
      versions: LEGAL_VERSIONS,
      urls: Object.fromEntries([...Object.keys(DOCS), "delete-account"].map((d) => [d, `${origin}/legal/${d}`])),
      dpoEmail: deps.config.DPO_EMAIL ?? null,
      contactEmail: deps.config.CONTACT_EMAIL ?? null,
    };
  });
}
