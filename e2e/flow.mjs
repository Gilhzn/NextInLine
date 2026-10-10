// End-to-end walkthrough of the real app (web build) against the real server, with screenshots.
//   BASE_URL=http://localhost:4000 node e2e/flow.mjs
// Env: BASE_URL, OUT_DIR (default e2e/screenshots), CHROMIUM_PATH (optional explicit browser binary).
import fs, { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";
const OUT = path.resolve(process.env.OUT_DIR ?? "e2e/screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "he-IL" });
const errors = [];

// A realistic Hebrew receipt rendered to PNG, used as the uploaded file.
const receiptPage = await context.newPage();
await receiptPage.setContent(`<html dir="rtl"><body style="font-family:sans-serif;padding:24px;width:340px;background:#fff">
  <h2>נוי לוי – קלינאית תקשורת</h2><div>ע.מ. 012345678</div><hr/>
  <div>קבלה מס' 1042</div><div>תאריך: 12/09/2026</div><div>שם המטופל: נועה כהן</div>
  <div>טיפול קלינאות תקשורת – מפגש 1</div><h3>סה"כ שולם: 350.00 ₪</h3></body></html>`);
const receiptPath = path.join(OUT, "_receipt.png");
await receiptPage.screenshot({ path: receiptPath, fullPage: true });
await receiptPage.close();

const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const vis = (locator) => locator.filter({ visible: true });
const click = (name) => vis(page.getByRole("button", { name })).first().click();
const see = (text, timeout = 30_000) =>
  vis(page.getByText(text))
    .first()
    .waitFor({ timeout })
    .catch(async (e) => {
      await page.screenshot({ path: path.join(OUT, "FAILED.png") }).catch(() => {});
      throw e;
    });
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(700);
  n += 1;
  await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`) });
  console.log(`✓ ${name}`);
};

const phone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const phoneE164 = `+972${phone.slice(1)}`;

/** The ops console token: $ADMIN_TOKEN, or the one `npm run demo` generated in apps/server/.env. */
function adminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  const envFile = fs.readFileSync(path.resolve("apps/server/.env"), "utf8");
  const line = envFile.split("\n").find((l) => l.startsWith("ADMIN_TOKEN="));
  if (!line) throw new Error("ADMIN_TOKEN not found");
  return line.slice("ADMIN_TOKEN=".length).trim().replace(/^"|"$/g, "");
}

await page.goto(BASE_URL);
await see("בוא נבדוק כמה מגיע לי");
await shot("welcome");

await click("בוא נבדוק כמה מגיע לי");
await vis(page.getByLabel("מספר נייד")).fill(phone);
await shot("phone");
await click("שלחו לי קוד");
await see("סביבת הדגמה");
await shot("otp-demo");
await click("מלא את הקוד");

await see("על מי נבדוק?");
await vis(page.getByLabel("השם שלך")).fill("מיכל כהן");
await click("הוספת בן משפחה");
await vis(page.getByLabel("שם", { exact: true })).fill("נועה");
await vis(page.getByLabel("תאריך לידה")).fill("2020-05-01");
await click("הוספה");
await see("ילד/ה");
await shot("family");
await click("המשך");

await see("איך אתם מבוטחים?");
await vis(page.getByRole("button", { name: "מכבי", exact: true })).click();
await click("מכבי שלי");
await click("הראל – שירותים אמבולטוריים");
await shot("coverage");
await click("המשך");

await see("זה מה שמגיע לכם");
await see("התפתחות הילד");
await shot("coverage-map");
await click("יש לי קבלות? בוא נמצא כסף");

await see("איפה הקבלות שלך?");
const chooser = page.waitForEvent("filechooser");
await click("בחר מהגלריה");
await (await chooser).setFiles(receiptPath);
await see("בקבלות שמצאנו");
await page.waitForTimeout(2500);
await shot("retro-upload");
await click("המשך");

await see("כמעט סיימנו");
await vis(page.getByRole("checkbox")).first().click();
await vis(page.getByLabel("מספר כרטיס (סביבת פיתוח)")).fill("4580123412341234");
await click("שמירת אמצעי תשלום");
await see("אמצעי תשלום נשמר");
await shot("agreements");
await click("סיימנו, בוא נתחיל");

await see("החזרנו לכם השנה");
await see("קבלה מחכה לאישור פרטים");
await shot("home");

await vis(page.getByText("קבלה מחכה לאישור פרטים")).first().click();
await see("על מי?");
await click("נועה");
await click(/התפתחות הילד/);
await vis(page.getByLabel("נותן השירות")).fill("נוי לוי – קלינאית תקשורת");
await vis(page.getByLabel("תאריך", { exact: true })).fill("2026-09-12");
await vis(page.getByLabel("סכום ששולם (₪)")).fill("350");
await shot("receipt-review");
await click("הכל נכון, כמה מגיע לי?");

await see("כך תקבל את הכסף");
await see("246.50");
await shot("money-route");

const chooser2 = page.waitForEvent("filechooser");
await click("מהגלריה");
await (await chooser2).setFiles(receiptPath);
await click("הגש עכשיו");
await see("פתח תיק מוכן להגשה");
await shot("claim-submitted");

await click("פתח תיק מוכן להגשה");
await see("הגשה למכבי");
await shot("submission-pack");
await click("הגשתי ✓ תעקבו בשבילי");

await see("קיבלת תשובה ממכבי?");
await vis(page.getByLabel("כמה הגיע (₪)")).first().fill("200");
await click("הכסף הגיע ✓");
await see("ממתין לשלב הקודם", 2000).catch(() => {});
await see("מוכן להגשה");
await shot("first-payment");
const claimUrl = page.url();

// Second leg: the user submits to the private insurer; operations (standing in for the insurer) pays it.
await click("פתח תיק מוכן להגשה");
await see("הגשה להראל");
await click("הגשתי ✓ תעקבו בשבילי");
await see("קיבלת תשובה מהראל?");

const ops = await context.newPage();
ops.on("pageerror", (e) => errors.push(`ops: ${e.message}`));
const opsVis = (l) => l.filter({ visible: true });
await ops.goto(`${BASE_URL}/ops`);
await opsVis(ops.getByPlaceholder("ADMIN_TOKEN")).fill(adminToken());
await opsVis(ops.getByRole("button", { name: "כניסה" })).click();
const legCard = opsVis(ops.locator("#legs .card")).filter({ hasText: phoneE164 }).filter({ hasText: "הראל" }).first();
await legCard.waitFor({ timeout: 15_000 });
const opsShot = async (name) => {
  n += 1;
  await ops.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`), fullPage: true });
  console.log(`✓ ${name}`);
};
const toast = (text) => ops.locator("#msg").filter({ hasText: text }).waitFor({ timeout: 15_000 });
await opsShot("ops-queue");
await legCard.getByRole("button", { name: "בבדיקה" }).click();
await toast("✓ בבדיקה");
await legCard.getByRole("button", { name: "💸 שולם" }).click();
await toast("✓ שולם");
const feeCard = opsVis(ops.locator("#fees .card")).filter({ hasText: phoneE164 }).first();
await feeCard.getByRole("button", { name: /חייב עכשיו/ }).click();
await toast("✓ חויב");
await opsShot("ops-fee-charged");
await ops.close();

await page.goto(claimUrl);
await see("הכסף הגיע");
await shot("claim-completed");

await page.goto(`${BASE_URL}/notifications`);
await see(/שולם|הכסף/);
await shot("notifications");

await page.goto(`${BASE_URL}/settings`);
await see("עמלות הצלחה");
await see("חויבה");
await shot("settings-fees");

await page.goto(`${BASE_URL}/benefits`);
await vis(page.getByLabel("חיפוש")).fill("פסיכולוג");
await see("טיפול רגשי ופסיכולוג");
await shot("benefits-search");

await browser.close();
if (errors.length > 0) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`\nAll steps passed. Screenshots: ${OUT}`);
