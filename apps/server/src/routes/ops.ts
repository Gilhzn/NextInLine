import type { FastifyInstance } from "fastify";

/**
 * Operations console (spec §14, v1.1): a single page over the admin API.
 * Ops staff record what payers answered (received / approved / paid / rejected) and resolve fees.
 * In the demo it also lets a tester play the role of the HMO/insurer to finish a claim end to end.
 * All user data is inserted with textContent – never innerHTML.
 */
const PAGE = /* html */ `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>מגיע לי – ממשק תפעול</title>
<style>
  :root { --p:#0F766E; --pd:#115E59; --ps:#E6F4F1; --money:#15803D; --warn:#B45309; --ws:#FEF3C7; --danger:#B91C1C; --bg:#F8FAFC; --s:#fff; --t:#0F172A; --m:#475569; --b:#E2E8F0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; background:var(--bg); color:var(--t); font-size:15px; }
  header { background:var(--p); color:#fff; padding:14px 16px; display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  main { max-width:1100px; margin:0 auto; padding:16px; }
  .card { background:var(--s); border:1px solid var(--b); border-radius:12px; padding:14px; margin-bottom:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
  .stat b { display:block; font-size:22px; color:var(--p); }
  h2 { font-size:16px; margin:20px 0 8px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
  .meta { color:var(--m); font-size:13px; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; background:var(--ps); color:var(--pd); font-size:12px; font-weight:600; }
  .badge.paid { background:#DCFCE7; color:var(--money); } .badge.rejected { background:#FEE2E2; color:var(--danger); }
  button { min-height:38px; border-radius:10px; border:1.5px solid var(--p); background:var(--s); color:var(--p); font-weight:600; padding:0 12px; cursor:pointer; font-size:14px; }
  button.primary { background:var(--p); color:#fff; } button.danger { border-color:var(--danger); color:var(--danger); }
  button:disabled { opacity:.5; cursor:default; }
  input { min-height:38px; border:1.5px solid var(--b); border-radius:10px; padding:0 10px; font-size:14px; }
  input.amount { width:110px; }
  .actions { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:8px; }
  #login { max-width:420px; margin:60px auto; }
  #msg { position:fixed; bottom:16px; left:16px; right:16px; max-width:500px; margin:auto; background:var(--t); color:#fff; padding:12px 16px; border-radius:10px; display:none; }
  .empty { color:var(--m); padding:8px 0; }
  .tabs { display:flex; gap:6px; flex-wrap:wrap; }
  .tabs button.on { background:var(--p); color:#fff; }
</style>
</head>
<body>
<header>
  <h1>🛠 מגיע לי · ממשק תפעול</h1>
  <div id="who" class="meta" style="color:#E6F4F1"></div>
</header>

<section id="login" class="card" hidden>
  <h2 style="margin-top:0">כניסת צוות</h2>
  <p class="meta">הזן את ה-ADMIN_TOKEN של השרת (ב-Render: השירות ← Environment).</p>
  <input id="token" type="password" placeholder="ADMIN_TOKEN" style="width:100%" />
  <div class="actions"><button class="primary" id="loginBtn">כניסה</button></div>
</section>

<main id="app" hidden>
  <div class="grid" id="stats"></div>

  <h2>תור עבודה: תביעות שממתינות לתשובת הגוף המשלם</h2>
  <div class="tabs" id="legTabs"></div>
  <div id="legs"></div>

  <h2>עמלות</h2>
  <div id="fees"></div>

  <h2>עבודות רקע שנכשלו</h2>
  <div id="jobs"></div>
  <div class="actions"><button id="refresh">רענון</button><button id="logout">יציאה</button></div>
</main>
<div id="msg"></div>

<script>
const $ = (id) => document.getElementById(id);
const ils = (a) => (a == null ? "—" : (a / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 }) + " ₪");
const LEG = { blocked:"ממתין לשלב קודם", ready:"מוכן להגשה", submitted:"הוגש", received:"התקבל", in_review:"בבדיקה", approved:"אושר", partially_approved:"אושר חלקית", rejected:"נדחה", paid:"שולם", skipped:"דולג" };
const FEE = { pending:"ממתין", scheduled:"מתוזמן", charged:"חויב", disputed:"במחלוקת", waived:"בוטל", failed:"נכשל", refunded:"הוחזר" };
const TABS = [
  { key:"submitted,received,in_review,approved,partially_approved", label:"ממתינים לתשובה" },
  { key:"ready", label:"מוכנים להגשה (אצל המשתמש)" },
  { key:"paid,rejected", label:"נסגרו" },
];
let tab = TABS[0].key;
let token = sessionStorage.getItem("magiali.ops") || "";

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c instanceof Node ? c : document.createTextNode(String(c ?? "")));
  return n;
}
function toast(t) { const m = $("msg"); m.textContent = t; m.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => (m.style.display = "none"), 3500); }

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "x-admin-token": token, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401) { logout(); throw new Error("טוקן לא תקין"); }
  if (!res.ok) throw new Error(data?.error?.message || ("שגיאה " + res.status));
  return data;
}

async function act(label, fn) {
  try { await fn(); toast("✓ " + label); await load(); } catch (e) { toast("✕ " + e.message); }
}

function legCard(l) {
  const amount = el("input", { class: "amount", type: "number", step: "0.01", value: ((l.approvedAgorot ?? l.expectedAgorot) / 100).toString(), "aria-label": "סכום" });
  const toAgorot = () => Math.round(Number(amount.value) * 100);
  const set = (status, extra = {}) => act(LEG[status], () => api("POST", "/admin/legs/" + l.id + "/status", { status, ...extra }));
  const open = ["submitted","received","in_review","approved","partially_approved"].includes(l.status);
  const actions = el("div", { class: "actions" });
  if (l.status === "ready") actions.append(el("button", { onclick: () => set("submitted") }, "סמן כהוגש"));
  if (["submitted"].includes(l.status)) actions.append(el("button", { onclick: () => set("received") }, "התקבל"));
  if (["submitted","received"].includes(l.status)) actions.append(el("button", { onclick: () => set("in_review") }, "בבדיקה"));
  if (open && !["approved","partially_approved"].includes(l.status)) actions.append(el("button", { onclick: () => set("approved", { amountAgorot: toAgorot() }) }, "אושר"));
  if (open) {
    actions.append(amount, el("button", { class: "primary", onclick: () => set("paid", { amountAgorot: toAgorot() }) }, "💸 שולם"));
    actions.append(el("button", { class: "danger", onclick: () => { const reason = prompt("סיבת הדחייה (כפי שהגוף כתב):", "חסר מסמך"); if (reason !== null) set("rejected", { reason }); } }, "נדחה"));
  }
  return el("div", { class: "card" },
    el("div", { class: "row" },
      el("div", {}, el("strong", {}, l.memberName + " · " + l.categoryLabel), " ", el("span", { class: "meta" }, "(" + (l.providerName || "") + ")")),
      el("span", { class: "badge " + (l.status === "paid" ? "paid" : l.status === "rejected" ? "rejected" : "") }, LEG[l.status] || l.status)),
    el("div", { class: "meta" }, "שלב " + l.seq + " · " + l.payerName + " · צפוי " + ils(l.expectedAgorot) + (l.paidAgorot != null ? " · שולם " + ils(l.paidAgorot) : "") + " · קבלה " + ils(l.amountAgorot) + " · " + (l.serviceDate || "") + " · משתמש " + (l.ownerPhone || "")),
    actions);
}

function feeCard(f) {
  const actions = el("div", { class: "actions" });
  if (f.status === "scheduled") actions.append(el("button", { class: "primary", onclick: () => act("חויב", () => api("POST", "/admin/fees/" + f.id + "/resolve", { action: "charge_now" })) }, "חייב עכשיו (בלי להמתין 3 ימים)"));
  if (["disputed","failed"].includes(f.status)) {
    actions.append(el("button", { onclick: () => act("חויב", () => api("POST", "/admin/fees/" + f.id + "/resolve", { action: "charge" })) }, "חייב"));
    actions.append(el("button", { class: "danger", onclick: () => act("בוטל", () => api("POST", "/admin/fees/" + f.id + "/resolve", { action: "waive" })) }, "ויתור על העמלה"));
  }
  return el("div", { class: "card" },
    el("div", { class: "row" }, el("strong", {}, ils(f.amountAgorot) + " (" + f.rateBps / 100 + "% מ-" + ils(f.baseAgorot) + ")"), el("span", { class: "badge" }, FEE[f.status] || f.status)),
    el("div", { class: "meta" }, "משתמש " + (f.ownerPhone || "") + (f.scheduledFor ? " · מתוזמן ל-" + new Date(f.scheduledFor).toLocaleString("he-IL") : "") + (f.disputeReason ? " · מחלוקת: " + f.disputeReason : "") + (f.failureReason ? " · כשל: " + f.failureReason : "")),
    actions);
}

async function load() {
  const [overview, legs, fees, jobs] = await Promise.all([
    api("GET", "/admin/overview"), api("GET", "/admin/legs?status=" + tab), api("GET", "/admin/fees"), api("GET", "/admin/jobs/failed"),
  ]);
  const count = (arr, s) => (arr.find((x) => x.status === s)?.n ?? 0);
  $("stats").replaceChildren(
    ...[["משתמשים", overview.users], ["שולם למשתמשים", ils(overview.paidToUsersAgorot)],
       ["תביעות בטיפול", count(overview.claims, "in_progress")], ["הושלמו", count(overview.claims, "completed") + count(overview.claims, "partially_paid")],
       ["עמלות שחויבו", ils(overview.fees.find((f) => f.status === "charged")?.agorot ?? 0)], ["עבודות שנכשלו", overview.failedJobs]]
      .map(([k, v]) => el("div", { class: "card stat" }, el("b", {}, v), k)));
  $("legTabs").replaceChildren(...TABS.map((t) => el("button", { class: t.key === tab ? "on" : "", onclick: () => { tab = t.key; load(); } }, t.label)));
  $("legs").replaceChildren(...(legs.length ? legs.map(legCard) : [el("div", { class: "empty" }, "אין כרגע")]));
  $("fees").replaceChildren(...(fees.length ? fees.map(feeCard) : [el("div", { class: "empty" }, "אין עמלות עדיין")]));
  $("jobs").replaceChildren(...(jobs.length ? jobs.map((j) => el("div", { class: "card meta" }, j.type + " · ניסיונות " + j.attempts + " · " + (j.lastError || ""))) : [el("div", { class: "empty" }, "אין 🎉")]));
}

function show() {
  $("login").hidden = !!token; $("app").hidden = !token;
  if (token) load().catch((e) => toast(e.message));
}
function logout() { token = ""; sessionStorage.removeItem("magiali.ops"); show(); }
$("loginBtn").onclick = () => { token = $("token").value.trim(); sessionStorage.setItem("magiali.ops", token); show(); };
$("token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });
$("refresh").onclick = () => load().catch((e) => toast(e.message));
$("logout").onclick = logout;
setInterval(() => { if (token && document.visibilityState === "visible") load().catch(() => {}); }, 15000);
show();
</script>
</body>
</html>`;

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ops", async (_req, reply) =>
    reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex").send(PAGE),
  );
}
