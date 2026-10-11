<div dir="rtl">

# "מגיע לי": איפיון מלא (מוצר, UX, צד שרת ותשתית)

> גרסה 1.0 · אוקטובר 2026 · המסמך המחייב לפיתוח
>
> מסמכי רקע: [ניתוח מתחרים ו-UX](magia-li-competitors-and-ux.md) · [רגולציה והיקף כספי](regulation-and-market-size.md) · [הרעיון](market-gap-idea.md)
>
> **המוצר במשפט אחד:** "צלם קבלה ותקבל כסף. אנחנו נדע ממי, באיזה סדר וכמה."

---

## תוכן עניינים

1. [היקף, מטרות ומונחים](#1-היקף-מטרות-ומונחים)
2. [החלטות טכנולוגיות](#2-החלטות-טכנולוגיות)
3. [ארכיטקטורה](#3-ארכיטקטורה)
4. [מודל נתונים](#4-מודל-נתונים)
5. [מנוע כללי הכיסוי](#5-מנוע-כללי-הכיסוי)
6. [מחזור החיים של תביעה (State Machine)](#6-מחזור-החיים-של-תביעה)
7. [חילוץ נתונים מקבלות (AI)](#7-חילוץ-נתונים-מקבלות)
8. [עמלות וחיובים](#8-עמלות-וחיובים)
9. [API](#9-api)
10. [עבודות רקע (Jobs)](#10-עבודות-רקע)
11. [התראות](#11-התראות)
12. [אבטחה, פרטיות ורגולציה](#12-אבטחה-פרטיות-ורגולציה)
13. [אפליקציית המובייל: מבנה, ניווט ומסכים](#13-אפליקציית-המובייל)
14. [ממשק תפעול (Back-office)](#14-ממשק-תפעול)
15. [סביבות, פריסה ו-CI/CD](#15-סביבות-פריסה-ו-cicd)
16. [בדיקות](#16-בדיקות)
17. [תצפיתיות ותפעול](#17-תצפיתיות)
18. [תוכנית שחרור ו-Roadmap](#18-תוכנית-שחרור)
19. [נספחים](#19-נספחים)

---

## 1. היקף, מטרות ומונחים

### 1.1 מה בונים ב-MVP
| כלול | לא כלול (בהמשך) |
|------|-----------------|
| אפליקציה ל-iOS ול-Android (קוד אחד) | אפליקציית ווב למשתמשים |
| הרשמה בטלפון + OTP | חיבור לחשבון מייל |
| ניהול משפחה (מנהל + בני משפחה, הסכמה ב-SMS לבגירים) | משיכה אוטומטית של פוליסות (רישיון שירות מידע פיננסי) |
| הגדרת כיסויים: קופה + שב"ן + ביטוחים פרטיים (קטלוג) | ערוץ מעסיקים (B2B) |
| צילום והעלאת קבלות, וחילוץ שדות ב-AI | ערעורים (מופנים לעורך דין שותף) |
| מנוע כללים: חלוקת ההחזר בין הגופים, לפי סדר | תביעות סיעוד או ביטוח לאומי |
| יצירת תביעה רב-שלבית (שב"ן ואז פרטי) | הגשה אוטומטית לפורטלים |
| הגשה: "תיק מוכן" (המשתמש שולח) או מייל עם ייפוי כוח | |
| מעקב סטטוס (עדכון ידני-למחצה על ידי צוות התפעול) | |
| עמלת הצלחה: חישוב, חיוב מושהה, מחלוקת | |
| התראות פוש | |
| פרטיות: הסכמות, יומן ביקורת, מחיקת חשבון | |
| ממשק תפעול (API) לעדכון סטטוסים | |

### 1.2 מונחים
| מונח | הגדרה |
|------|-------|
| **Household (משק בית)** | יחידת החשבון. יש לו בעלים (owner) ובני משפחה |
| **Member (בן משפחה)** | אדם שתביעות מוגשות עבורו. יכול להיות בעל משתמש משלו (בגיר) או לא (ילד) |
| **Payer (גוף משלם)** | שב"ן (למשל `maccabi_sheli`) או חברת ביטוח (למשל `harel`) |
| **Plan (תוכנית)** | מוצר ביטוחי ספציפי: רמת שב"ן, או פוליסה או נספח אצל מבטח |
| **Enrollment (שיוך)** | חיבור בין בן משפחה לתוכנית. כולל סוג (`shaban` / `private_individual` / `private_group`) ואת התנאי "משלים שב"ן" |
| **Benefit (כיסוי)** | כלל בתוך תוכנית לפי קטגוריית שירות: אחוז, תקרה למפגש, תקרה שנתית, מספר מפגשים, מסמכים נדרשים |
| **Receipt (קבלה)** | מסמך שהועלה, עם שדות שחולצו |
| **Claim (תביעה)** | הבקשה הכוללת על קבלה אחת או יותר. מכילה **Legs** |
| **Claim Leg (שלב)** | הגשה לגוף משלם אחד. השלבים רצים לפי הסדר, והשלב הבא מחכה לתשלום של הקודם |
| **Routing (מסלול)** | תוצאת מנוע הכללים: אילו שלבים, כמה בכל שלב ואילו מסמכים |
| **Fee (עמלה)** | עמלת ההצלחה שנגבית מהמשתמש אחרי שהכסף שולם |

### 1.3 עקרונות על
1. **הכסף לא עובר דרכנו.** הגוף המשלם משלם ישירות למשתמש, ואנחנו גובים רק עמלה.
2. **סיוע אדמיניסטרטיבי בלבד:** בלי ייעוץ משפטי ובלי ניסוח ערעורים.
3. **מינימום מידע:** שומרים רק את מה שהתביעה דורשת. הצפנה בשכבת האפליקציה לשדות רגישים.
4. **הכללים הם נתונים ולא קוד.** כיסויים מוגדרים בקטלוג נתונים עם גרסאות, כך שצוות התפעול יכול לעדכן אותם בלי שחרור גרסה.
5. **דטרמיניזם:** אותו קלט למנוע הכללים מחזיר תמיד אותו מסלול. כל חישוב נשמר עם גרסת הקטלוג שבה השתמש.

---

## 2. החלטות טכנולוגיות

| שכבה | בחירה | נימוק |
|------|-------|-------|
| **מובייל** | **React Native + Expo** (TypeScript), Expo Router | קוד אחד ל-iOS ול-Android, ותמיכה מלאה ב-RTL. מצלמה, בורר תמונות, SecureStore ופוש מוכנים. EAS Build מטפל בבנייה ובהפצה לחנויות |
| **ניהול מצב במובייל** | TanStack Query (מצב שרת) + Zustand (מצב מקומי: auth ו-onboarding) | סטנדרט מוכח, ומטמון שמתאים לאפליקציה שמבוססת על נתוני שרת |
| **שרת** | **Node.js 22 + TypeScript + Fastify** | ביצועים, סכמות מובנות, וקוד משותף עם המובייל (טיפוסים, zod) |
| **ולידציה** | zod (משותף לשרת ולמובייל) | אותה סכמה בשני הצדדים |
| **מסד נתונים** | **PostgreSQL 16** | טרנזקציות, JSONB לכללים, `SKIP LOCKED` לתור עבודות |
| **גישה ל-DB** | `postgres` (porsager), SQL מפורש, מיגרציות SQL | שליטה מלאה, בלי ORM כבד |
| **אחסון קבצים** | S3-compatible (בפיתוח: דיסק מקומי), הצפנה בצד האפליקציה (AES-256-GCM) | מסמכים רפואיים |
| **חילוץ קבלות** | **Claude API** (`claude-opus-5-5`, vision + structured outputs) | קריאה טובה של עברית וכתב יד, ופלט JSON תקין לפי סכמה |
| **Auth** | OTP ב-SMS + JWT (access 15 דק', refresh 30 יום עם רוטציה) | בלי סיסמאות |
| **פוש** | Expo Push Service (APNs/FCM) | אינטגרציה פשוטה |
| **SMS** | ספק ישראלי דרך ממשק (`SmsProvider`). בפיתוח: לוג | — |
| **סליקה** | ספק ישראלי עם טוקניזציה (Tranzila / PayPlus / Cardcom) דרך ממשק `PaymentProvider`. בפיתוח: mock | Bit, Apple Pay, Google Pay |
| **בדיקות** | Vitest (יחידה ואינטגרציה מול Postgres אמיתי) | מהיר |
| **CI** | GitHub Actions | typecheck + tests |
| **Monorepo** | npm workspaces: `apps/mobile`, `apps/server`, `packages/shared` | קוד משותף |

---

## 3. ארכיטקטורה

```
┌──────────────────────┐        HTTPS/JSON        ┌───────────────────────────────────────┐
│  Mobile (Expo RN)    │ ───────────────────────► │  API Server (Fastify)                 │
│  iOS + Android       │ ◄─────────────────────── │  ├─ auth        ├─ claims             │
│  ├─ Expo Router      │                          │  ├─ household   ├─ fees               │
│  ├─ TanStack Query   │                          │  ├─ coverage    ├─ notifications      │
│  ├─ SecureStore(JWT) │                          │  ├─ receipts    ├─ privacy            │
│  └─ Camera/Picker    │                          │  └─ admin (ops)                       │
└──────────────────────┘                          └──────┬──────────────┬─────────────────┘
                                                         │              │
                                ┌────────────────────────▼──┐   ┌───────▼──────────────┐
                                │ PostgreSQL 16              │   │ Object storage (S3)  │
                                │ ├─ domain tables           │   │ encrypted receipts   │
                                │ ├─ coverage catalog (JSONB)│   └──────────────────────┘
                                │ ├─ jobs (SKIP LOCKED)      │
                                │ └─ audit_log               │
                                └────────────┬───────────────┘
                                             │
                                ┌────────────▼───────────────┐      ┌─────────────────────┐
                                │ Worker (same codebase)      │ ───► │ Claude API (vision) │
                                │ ├─ extract_receipt          │      │ SMS / Push / Email  │
                                │ ├─ submit_leg / next_leg    │      │ Payment provider    │
                                │ ├─ charge_fee (T+3 days)    │      └─────────────────────┘
                                │ ├─ reminders / expiry       │
                                │ └─ purge_deleted_accounts   │
                                └─────────────────────────────┘
```

- **שרת אחד, שני תפקידים:** `server` (HTTP) ו-`worker` (עבודות רקע), שמופעלים לפי משתנה סביבה. שניהם חסרי מצב, ולכן אפשר להריץ כמה עותקים.
- **תור עבודות ב-Postgres:** טבלת `jobs` עם `SELECT ... FOR UPDATE SKIP LOCKED`. מספיק עד מאות אלפי משתמשים, בלי רכיב תשתית נוסף.
- **קוד משותף (`packages/shared`):** סכמות zod, טיפוסים, מנוע הכללים וחישוב העמלה. המובייל משתמש בטיפוסים בלבד. החישוב המחייב נעשה בשרת.

---

## 4. מודל נתונים

> הסכמה המלאה נמצאת ב-`apps/server/migrations/*.sql`. כל הטבלאות כוללות `created_at` ו-`updated_at`. מזהים: UUID v4. סכומים: **אגורות (integer)**. אין float בכסף.

### 4.1 זהות ומשק בית
```
users(id, phone_e164 UNIQUE, display_name, locale DEFAULT 'he', deleted_at)
otp_challenges(id, phone_e164, code_hash, expires_at, attempts, consumed_at)
refresh_tokens(id, user_id→users, token_hash UNIQUE, expires_at, revoked_at, replaced_by)
households(id, owner_user_id→users)
members(id, household_id→households, user_id→users NULL, full_name, relation
        ['self','spouse','child','parent','other'], birth_date NULL,
        consent_status ['not_required','pending','granted','revoked'],
        consent_phone_e164 NULL, consent_granted_at NULL)
member_access(member_id→members, user_id→users, role ['manager','viewer'])
```
- **ילד מתחת לגיל 18:** `consent_status='not_required'`.
- **בגיר (בן זוג או הורה):** `pending` עד שאישר ב-SMS. עד אז **אי אפשר להגיש** עבורו תביעות.

### 4.2 קטלוג כיסויים (נתונים בגרסאות)
```
payers(id TEXT PK e.g. 'maccabi_sheli', name_he, kind ['shaban','insurer'],
       submission_channels JSONB, avg_processing_days INT)
plans(id TEXT PK e.g. 'maccabi_sheli', payer_id→payers, name_he,
      plan_kind ['shaban','private_individual','private_group'])
catalog_versions(id SERIAL, published_at, notes)
benefits(id, plan_id→plans, catalog_version→catalog_versions, category
         ['specialist_visit','physiotherapy','psychology','child_development',
          'diagnostic_imaging','lab_tests','alternative_medicine','glasses_lenses',
          'dental','second_opinion','medical_devices','other'],
         rule JSONB)  -- ראו סעיף 5.2
```

### 4.3 שיוכים
```
enrollments(id, member_id→members, plan_id→plans, policy_number_enc NULL,
            is_shaban_supplement BOOLEAN,   -- פוליסה "משלים שב"ן"
            source ['manual','har_habituach','document'], valid_from, valid_to NULL)
```

### 4.4 קבלות ומסמכים
```
documents(id, household_id, member_id NULL, kind ['receipt','visit_summary','referral',
          'payer_payment_proof','policy','other'], storage_key, mime_type, size_bytes,
          sha256, encryption_key_id, uploaded_by→users)
receipts(id, document_id→documents, member_id→members NULL,
         extraction_status ['pending','processing','done','failed','manual'],
         extracted JSONB,           -- תוצאת המודל (סכמה בסעיף 7)
         confirmed JSONB NULL,      -- מה שהמשתמש אישר
         category, provider_name, service_date, amount_agorot, sessions INT,
         confidence JSONB)          -- ציון ביטחון לכל שדה
```

### 4.5 תביעות
```
claims(id, household_id, member_id, status ['draft','awaiting_documents','ready',
       'in_progress','completed','partially_paid','rejected','cancelled'],
       is_retro BOOLEAN, catalog_version INT, routing JSONB,
       total_expected_agorot, total_paid_agorot, created_by→users, privacy_private BOOLEAN)
claim_receipts(claim_id→claims, receipt_id→receipts)
claim_legs(id, claim_id→claims, seq INT, payer_id→payers, plan_id→plans,
           status ['blocked','ready','submitted','received','in_review','approved',
                   'partially_approved','rejected','paid','skipped'],
           expected_agorot, approved_agorot NULL, paid_agorot NULL,
           submission_channel ['user_handoff','email_poa'], submitted_at, decided_at, paid_at,
           payer_reference NULL, rejection_reason NULL)
claim_required_docs(id, claim_id, kind, status ['missing','provided','waived'], document_id NULL)
claim_events(id, claim_id, leg_id NULL, type, from_status, to_status, actor
             ['user','system','ops'], actor_id, payload JSONB, at)
```

### 4.6 עמלות ותשלומים
```
payment_methods(id, user_id, provider, provider_token_enc, brand, last4, is_default)
fees(id, claim_id UNIQUE, household_id, rate_bps INT, cap_agorot INT, base_agorot,
     amount_agorot, status ['pending','scheduled','charged','disputed','waived','failed','refunded'],
     scheduled_for TIMESTAMPTZ, charged_at, provider_charge_id, failure_reason)
```

### 4.7 התראות, הסכמות וביקורת
```
push_tokens(id, user_id, expo_token UNIQUE, platform, last_seen_at)
notifications(id, user_id, type, title, body, data JSONB, sent_at, read_at)
consents(id, user_id, kind ['terms','privacy','poa','marketing','member_access'],
         version, granted_at, revoked_at, evidence JSONB)
audit_log(id, actor_user_id NULL, actor_kind ['user','system','ops'], action,
          entity, entity_id, ip, at, meta JSONB)          -- append-only
jobs(id, type, payload JSONB, run_at, attempts, max_attempts, locked_at, locked_by,
     last_error, done_at)
```

---

## 5. מנוע כללי הכיסוי

### 5.1 קלט ופלט
```ts
computeRouting({
  category: BenefitCategory,
  amountAgorot: number,          // מה ששולם
  sessions: number,              // מספר מפגשים בקבלה (ברירת מחדל 1)
  serviceDate: string,           // ISO
  enrollments: EnrollmentWithBenefits[],   // השיוכים של בן המשפחה + הכללים
  usage: UsageLedger,            // ניצול שנתי קיים לפי plan+category (מפגשים, ₪)
}) => {
  legs: Array<{ seq, planId, payerId, expectedAgorot, basis: string, requiredDocs: DocKind[] }>,
  totalExpectedAgorot: number,
  uncoveredAgorot: number,
  notes: string[]                // הסברים בעברית ("נוצלו 10 מתוך 12 מפגשים")
}
```

### 5.2 מבנה כלל (rule JSONB)
```json
{
  "percent": 75,                    // אחוז החזר מהבסיס
  "per_session_cap_agorot": 30000,  // תקרה למפגש (אופציונלי)
  "per_session_fixed_agorot": null, // החזר קבוע למפגש (אם מוגדר, גובר על percent)
  "annual_cap_agorot": 300000,      // תקרה שנתית (אופציונלי)
  "annual_sessions": 12,            // מספר מפגשים בשנה (אופציונלי)
  "deductible_agorot": 0,           // השתתפות עצמית לכל קבלה
  "required_docs": ["receipt","referral"],
  "min_age": null, "max_age": 18    // הגבלת גיל (אופציונלי)
}
```

### 5.3 אלגוריתם (דטרמיניסטי)
1. **סינון שיוכים:** רק שיוכים שבתוקף בתאריך השירות, שיש להם כלל לקטגוריה, ושעומדים בהגבלת הגיל.
2. **סדר שלבים:**
   - (א) **שב"ן** קודם.
   - (ב) אחר כך פוליסות פרט **מסוג "משלים שב"ן"**. הבסיס שלהן הוא **ההפרש** שנשאר אחרי השב"ן.
   - (ג) פוליסות פרט רגילות ("שקל ראשון"). לפי ההנחה השמרנית במנוע, גם הן מחושבות על ההפרש, כדי לא להבטיח כפל.
   - (ד) ביטוח קבוצתי.
   - בתוך כל קבוצה: לפי `plan_id`, לדטרמיניזם.
3. **לכל שלב:**
   - `base` = מה שנשאר לא מכוסה מהשלבים הקודמים.
   - `eligibleSessions = min(sessions, annual_sessions − used_sessions)`.
   - אם `per_session_fixed`: `amount = fixed × eligibleSessions`.
   - אחרת: `amount = base × percent / 100`, ואם יש `per_session_cap`: `amount = min(amount, cap × eligibleSessions)`.
   - אם `eligibleSessions < sessions` ואין `per_session_fixed`: `amount = amount × eligibleSessions / sessions` (מעוגל כלפי מטה).
   - `amount = min(amount, annual_cap − used_amount)`, ואחר כך `amount −= deductible`, ולבסוף `amount = clamp(0, base)`.
   - עיגול: **כלפי מטה לאגורה**.
4. **שלב שיוצא 0** לא נכנס למסלול. נוספת הערה שמסבירה למה.
5. **מסמכים נדרשים:** איחוד של `required_docs` בכל השלבים. בשלב שאינו ראשון מתווסף `payer_payment_proof` (אישור תשלום מהשלב הקודם).

### 5.4 בדיקות חובה למנוע
| מקרה | ציפייה |
|------|---------|
| שב"ן בלבד, 50% | שלב אחד = 50% |
| שב"ן 50% + משלים 60% | שלב 2 = 60% מההפרש. **דוגמת ה-UX:** 350 ₪ = 175 + 105 |
| מכסת מפגשים מוצתה | 0 בשב"ן, הערה, והפרטי מחשב על הסכום המלא |
| תקרה שנתית חלקית | חיתוך לפי היתרה |
| החזר קבוע למפגש (85 ₪) + ביטוח קבוצתי 50% על ההפרש | דוגמת הפסיכולוג: 450 = 85 + 182.50 |
| תאריך שירות מחוץ לתוקף השיוך | השיוך מסונן |
| הגבלת גיל | ילד בן 19 לא מקבל את כיסוי "התפתחות הילד" |
| סכום 0 או שלילי | שגיאת ולידציה |

---

## 6. מחזור החיים של תביעה

### 6.1 סטטוס התביעה
```
draft ──(routing computed)──► awaiting_documents ──(all docs)──► ready
ready ──(user submits)──► in_progress
in_progress ──(all legs terminal)──► completed | partially_paid | rejected
draft|awaiting_documents|ready ──(user cancels)──► cancelled
```
- **`completed`:** כל השלבים שולמו (או דולגו).
- **`partially_paid`:** לפחות שלב אחד שולם, ולפחות אחד נדחה.
- **`rejected`:** שום שלב לא שולם.

### 6.2 סטטוס שלב (Leg)
```
blocked ──(previous leg paid / first leg)──► ready
ready ──(submission done)──► submitted ──► received ──► in_review
in_review ──► approved | partially_approved | rejected
approved|partially_approved ──► paid
blocked|ready ──(previous leg rejected & plan requires payment proof)──► skipped
```
- **מעברים חוקיים בלבד:** כל מעבר עובר דרך פונקציה אחת, `transitionLeg()`. היא בודקת שהמעבר מותר, כותבת `claim_events` ומפעילה תופעות לוואי: פתיחת השלב הבא, עדכון סטטוס התביעה ותזמון עמלה.
- **שלב שנדחה:** אם השלב הבא דורש `payer_payment_proof`, הוא עובר ל-`skipped`. אחרת הוא נפתח (`ready`) עם בסיס מחושב מחדש, כלומר הסכום המלא.
- **אידמפוטנטיות:** בקשת מעבר שכבר בוצע מחזירה 200 בלי לעשות שוב את תופעות הלוואי.

### 6.3 הגשה
| ערוץ | מה קורה | מתי |
|------|---------|-----|
| **`user_handoff`** | השרת מחזיר "תיק מוכן": שדות מוכנים להעתקה, קישורים למסמכים (URLs חתומים) ו-deep link לאפליקציית הגוף המשלם. המשתמש מגיש ומאשר באפליקציה "הגשתי" | ברירת מחדל ב-MVP |
| **`email_poa`** | Job `submit_leg` שולח מייל לכתובת התביעות של הגוף, עם המסמכים וייפוי כוח חתום | לגופים שמקבלים הגשה במייל |

**עדכוני סטטוס ב-MVP:** המשתמש מעדכן (למשל "קיבלתי הודעה שאושר"), או שצוות התפעול מעדכן דרך ה-Admin API על סמך מייל או מסרון מהגוף. כל עדכון נרשם עם `actor`.

---

## 7. חילוץ נתונים מקבלות

### 7.1 זרימה
```
POST /v1/receipts (upload) → documents + receipts(status=pending) → job extract_receipt
worker: decrypt → Claude vision (structured output) → validate (zod) → receipts.extracted + confidence
→ status=done → push "הקבלה מוכנה לבדיקה"
```

### 7.2 סכמת הפלט
```ts
{
  is_medical_receipt: boolean,
  provider_name: string | null,        // שם המטפל או המכון
  provider_tax_id: string | null,      // ח.פ./ע.מ.
  patient_name: string | null,
  service_date: string | null,         // YYYY-MM-DD
  amount_ils: number | null,           // סכום ששולם
  sessions: number | null,
  category: BenefitCategory | null,
  description: string | null,
  field_confidence: { provider_name, service_date, amount_ils, sessions, category: 'high'|'medium'|'low' }
}
```

### 7.3 מפרט הקריאה ל-Claude
- **מודל:** `claude-opus-5-5`. **effort:** `medium`. **Structured outputs:** `output_config.format` עם JSON Schema, כך שהפלט תמיד תקין לפי הסכמה.
- **Fallback בסירוב:** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). בודקים `stop_reason === "refusal"` לפני קריאת התוכן. אם אין תוצאה, הסטטוס הוא `manual` והמשתמש ממלא את השדות בעצמו.
- **פרטיות:** שולחים רק את תמונת הקבלה, בלי מזהים נוספים. **לא שולחים** ת"ז או פרטי פוליסה.
- **עלות:** בערך תמונה אחת ופלט קצר. לוגים של `usage` לכל קריאה, לצורך ניטור עלויות.
- **שגיאות:** `RateLimitError` ושגיאות 5xx מחזירות את ה-job לתור עם backoff. אחרי 3 כישלונות: `failed`, ואז `manual`.
- **ספק חלופי:** `EXTRACTION_PROVIDER=manual` (בפיתוח או בלי מפתח API) מחזיר תוצאה ריקה, והמשתמש ממלא ידנית.

---

## 8. עמלות וחיובים

| פרמטר | ערך ברירת מחדל |
|-------|-----------------|
| עמלה רגילה | **15%** (1500 bps) |
| עמלה על תביעה מסריקה לאחור | **20%** (2000 bps) |
| תקרה לתביעה | **150 ₪** (15,000 אגורות) |
| עיכוב חיוב אחרי "שולם" | **3 ימים** |
| ביטול ללא שאלות | 14 ימים מההרשמה או מקבלת מסמך הגילוי (סעיף 14ג לחוק הגנת הצרכן) |

- **בסיס העמלה:** סכום ה-`paid_agorot` בפועל (לא הצפוי), לכל השלבים.
- **`amount = min(floor(base × rate_bps / 10000), cap)`.**
- **תזמון:** כשהשלב **האחרון** בתביעה נסגר בתשלום (או שהתביעה הגיעה לסטטוס סופי עם תשלום כלשהו), נוצרת `fees(status=scheduled, scheduled_for = now()+3d)` ונכנס job `charge_fee`.
- **מחלוקת:** `POST /v1/fees/:id/dispute` לפני `scheduled_for` מעביר ל-`disputed` ומבטל את החיוב. צוות התפעול מכריע.
- **כישלון חיוב:** 3 ניסיונות (יום, 3 ימים, 7 ימים). אחר כך `failed` והתראה. **לא חוסמים** תביעות חדשות ב-MVP.

---

## 9. API

> בסיס: `/v1`. JSON. אימות: `Authorization: Bearer <access>`. שגיאות: `{ error: { code, message, details? } }`. ולידציה: zod. כל סכום ב**אגורות**. תאריכים: ISO.

### 9.1 Auth
| Method | Path | תיאור |
|--------|------|-------|
| POST | `/auth/otp/request` | `{phone}` → שולח קוד. מוגבל ל-3 בקשות ב-10 דקות לטלפון ול-20 בשעה ל-IP |
| POST | `/auth/otp/verify` | `{phone, code}` → `{accessToken, refreshToken, user, isNew}`. יוצר משתמש, משק בית ו-member מסוג `self` אם המשתמש חדש |
| POST | `/auth/refresh` | `{refreshToken}` → זוג טוקנים חדש (רוטציה. שימוש חוזר בטוקן = ביטול כל השרשרת) |
| POST | `/auth/logout` | מבטל את ה-refresh token |

### 9.2 משתמש ומשק בית
| Method | Path | תיאור |
|--------|------|-------|
| GET | `/me` | משתמש + משק בית + בני משפחה + הסכמות |
| PATCH | `/me` | `{displayName}` |
| POST | `/consents` | `{kind, version}` |
| GET | `/members` | רשימה |
| POST | `/members` | `{fullName, relation, birthDate?, phone?}`. לבגיר: phone חובה, ונשלח SMS לאישור |
| PATCH | `/members/:id` | עדכון |
| DELETE | `/members/:id` | הסרה (רק אם אין תביעות פעילות) |
| POST | `/members/consent/confirm` | `{token, code}`. בן המשפחה מאשר (מקישור ב-SMS) |

### 9.3 כיסויים
| Method | Path | תיאור |
|--------|------|-------|
| GET | `/catalog/plans` | רשימת התוכניות לבחירה (מקובצות לפי סוג וגוף) |
| GET | `/members/:id/enrollments` | |
| PUT | `/members/:id/enrollments` | החלפת כל השיוכים: `[{planId, isShabanSupplement, policyNumber?}]` |
| GET | `/coverage/map` | מפת הכיסויים של כל משק הבית: לכל קטגוריה, לכל בן משפחה, הכללים והיתרות |
| GET | `/coverage/search?q=&memberId=` | "מה מגיע לי על...": התאמת טקסט לקטגוריה + סימולציה על סכום לדוגמה |
| POST | `/coverage/simulate` | `{memberId, category, amountAgorot, sessions, serviceDate}` → routing (בלי לשמור) |

### 9.4 קבלות
| Method | Path | תיאור |
|--------|------|-------|
| POST | `/receipts` | multipart: `file` (jpeg/png/heic/pdf, עד 15MB), `memberId?`. → `{receipt}` (status=pending) |
| GET | `/receipts/:id` | כולל `extracted`, `confidence` ו-URL חתום לתמונה (5 דק') |
| PATCH | `/receipts/:id` | אישור או תיקון: `{memberId, category, providerName, serviceDate, amountAgorot, sessions}` |
| DELETE | `/receipts/:id` | מחיקה (רק אם לא משויכת לתביעה שהוגשה) |
| POST | `/documents` | העלאת מסמך נלווה (סיכום ביקור, הפניה, אישור תשלום) |

### 9.5 תביעות
| Method | Path | תיאור |
|--------|------|-------|
| POST | `/claims` | `{receiptIds[], isRetro?}`. מחשב מסלול, יוצר תביעה ושלבים, ומחזיר אותה עם `routing`, `requiredDocs` ו-`feePreview` |
| GET | `/claims?status=&memberId=` | רשימה |
| GET | `/claims/:id` | פרטים: שלבים, אירועים ומסמכים נדרשים |
| POST | `/claims/:id/documents` | `{kind, documentId}`. מסמן מסמך כ"סופק" |
| POST | `/claims/:id/submit` | מאשר הגשה. לשלב הראשון: יוצר "תיק מוכן" או מתזמן `submit_leg` |
| GET | `/claims/:id/legs/:legId/pack` | "תיק מוכן" לשלב (שדות + קישורים + deep link) |
| POST | `/claims/:id/legs/:legId/status` | עדכון סטטוס על ידי המשתמש: `{status: 'submitted'|'approved'|'rejected'|'paid', amountAgorot?, reason?}`. רק מעברים מותרים |
| POST | `/claims/:id/cancel` | ביטול (רק לפני הגשה) |

### 9.6 עמלות ותשלום
| Method | Path | תיאור |
|--------|------|-------|
| GET | `/fees` | רשימה |
| POST | `/fees/:id/dispute` | `{reason}`. מחלוקת לפני מועד החיוב |
| GET | `/payment-methods` · POST · DELETE `/payment-methods/:id` | טוקן מהספק (ה-SDK של הסליקה רץ במובייל, והשרת מקבל טוקן בלבד) |

### 9.7 בית, התראות ופרטיות
| Method | Path | תיאור |
|--------|------|-------|
| GET | `/home` | `{yearPaidAgorot, inFlightAgorot, actionItems[], opportunities[]}` |
| POST | `/push-tokens` | `{expoToken, platform}` |
| GET | `/notifications` · POST `/notifications/:id/read` | |
| GET | `/privacy/export` | ייצוא כל המידע (JSON) |
| DELETE | `/me` | מחיקת חשבון: מחיקה רכה מיידית ו-job מחיקה קשה אחרי 30 יום (אלא אם יש חובת שמירה, למשל רישומים כספיים, ואז מתבצעת אנונימיזציה) |

### 9.8 Admin (צוות התפעול)
אימות: `X-Admin-Token` (ב-MVP), ובהמשך SSO.

| Method | Path | תיאור |
|--------|------|-------|
| GET | `/admin/legs?status=submitted` | תור עבודה |
| POST | `/admin/legs/:id/status` | `{status, amountAgorot?, reason?, payerReference?}` |
| POST | `/admin/fees/:id/resolve` | `{action: 'charge'|'waive'}` |
| POST | `/admin/catalog/publish` | פרסום גרסת קטלוג חדשה (JSON) |

---

## 10. עבודות רקע

| Job | טריגר | מה עושה | ניסיונות |
|-----|-------|---------|---------|
| `extract_receipt` | העלאת קבלה | חילוץ ב-AI ועדכון הקבלה | 3, backoff אקספוננציאלי |
| `submit_leg` | הגשה בערוץ `email_poa` | שליחת מייל עם המסמכים וייפוי הכוח | 5 |
| `charge_fee` | `scheduled_for` | חיוב דרך ספק הסליקה | 3 (יום, 3 ימים, 7 ימים) |
| `send_notification` | אירועים | פוש | 3 |
| `remind_missing_docs` | תביעה ב-`awaiting_documents` 3 ימים | תזכורת | 1 |
| `remind_slow_payer` | שלב ב-`in_review` מעבר ל-`avg_processing_days` | הצעה לשלוח תזכורת | 1 |
| `expiry_warnings` | יומי | קבלות שקרובות להתיישנות (60 ו-14 ימים) | 1 |
| `purge_deleted` | יומי | מחיקה קשה אחרי 30 יום | 3 |

- **מנגנון:** `SELECT ... WHERE run_at <= now() AND done_at IS NULL AND (locked_at IS NULL OR locked_at < now() - interval '5 min') ORDER BY run_at LIMIT n FOR UPDATE SKIP LOCKED`.
- **ה-handlers חייבים להיות אידמפוטנטיים.**

---

## 11. התראות

| אירוע | כותרת | ערוץ |
|-------|--------|------|
| קבלה חולצה | "הקבלה מוכנה. בדוק ב-10 שניות" | פוש |
| חסר מסמך (3 ימים) | "חסר סיכום טיפול לתביעה של נועה (280 ₪)" | פוש |
| שלב שולם | "💸 175 ₪ הגיעו ממכבי שלי" | פוש |
| שלב נדחה | "התביעה נדחתה. יש מה לעשות" | פוש |
| עמלה תחויב מחר | "העמלה (42 ₪) תחויב מחר. הכסף לא הגיע? ספר לנו" | פוש |
| התיישנות מתקרבת | "קבלה של 650 ₪ תפוג בעוד 60 יום" | פוש |
| אישור בן משפחה | "אבי ביקש לנהל את התביעות שלך. אשר: [קישור]" | SMS |

- **שעות שקט:** 21:00–08:00 (Asia/Jerusalem). התראות לא דחופות נדחות.
- **מגבלת קצב:** עד 1 "הזדמנות" בשבוע. התראות סטטוס ללא הגבלה.

---

## 12. אבטחה, פרטיות ורגולציה

### 12.1 אבטחה
- **TLS בלבד.** HSTS. Helmet headers.
- **JWT:** חתימה HS256 עם סוד באורך 32 בתים ומעלה (בייצור: RS256 + KMS). Access ל-15 דק'.
- **Refresh:** נשמר כ-hash (SHA-256). רוטציה עם זיהוי שימוש חוזר.
- **OTP:** 6 ספרות, נשמר כ-hash עם pepper, תוקף 5 דק', עד 5 ניסיונות. השוואה ב-timing-safe.
- **Rate limiting:** לכל IP ולכל טלפון.
- **הרשאות (Authorization):** כל שאילתה מסוננת לפי `household_id` של המשתמש. ל-member יש `member_access`. **אין גישה בין משקי בית.** יש בדיקות לכך.
- **הצפנת קבצים:** AES-256-GCM עם מפתח לכל קובץ (DEK), שמוצפן במפתח ראשי (KEK) מ-KMS או ממשתנה סביבה בפיתוח.
- **שדות רגישים** (מספר פוליסה, טוקן תשלום): מוצפנים באותו מנגנון.
- **URLs חתומים** לקבצים: 5 דקות.
- **יומן ביקורת** לכל קריאה של מידע רגיש ולכל שינוי סטטוס.

### 12.2 פרטיות (תיקון 13)
- **הסכמות עם גרסה:** תנאים, פרטיות, ייפוי כוח ושיתוף בני משפחה. נשמרות עם הוכחה (זמן, IP, גרסה).
- **מינימום מידע:** לא שומרים אבחנות. שדה `description` מקוצר ל-120 תווים ומשמש רק להצגה.
- **פרטיות בתוך המשפחה:** תביעה שמסומנת `privacy_private` מוצגת למנהל כ"תביעה פרטית" + סכום בלבד.
- **ייצוא ומחיקה:** ראו 9.7.
- **ממונה פרטיות, מסמך הגדרות מאגר והודעה לרשות** כשמגיעים ל-100 אלף נושאי מידע.
- **מידע שנשלח ל-Claude:** תמונת הקבלה בלבד, ללא מזהים נוספים. מפרטים זאת במדיניות הפרטיות.

### 12.3 רגולציה במוצר
- **ייפוי כוח מצומצם:** הגשה ומעקב בלבד.
- **בלי ערעורים:** תביעה שנדחתה מקבלת כפתור "לבדוק עם עורך דין שותף" (קישור חיצוני).
- **בלי המלצות** לקנות או לבטל פוליסות. מפת הכיסויים מציגה מידע בלבד.
- **עמלה עם תקרה, חוזה אחיד, ביטול תוך 14 ימים (סעיף 14ג).**

---

## 13. אפליקציית המובייל

### 13.1 מבנה תיקיות
```
apps/mobile/
  app/                      # Expo Router (ניווט מבוסס קבצים)
    _layout.tsx             # Providers: Query, Auth, RTL, Theme
    (auth)/welcome.tsx      # [A] הבטחת ערך
    (auth)/phone.tsx        # [B] טלפון
    (auth)/otp.tsx          # [B] קוד
    (onboarding)/family.tsx     # [C]
    (onboarding)/coverage.tsx   # [D]+[E]
    (onboarding)/map.tsx        # [F] מפת כיסויים
    (onboarding)/retro.tsx      # [G]+[H]
    (onboarding)/agreements.tsx # [I] ייפוי כוח + תשלום
    (tabs)/_layout.tsx      # טאבים: בית, תביעות, צלם, כיסויים, משפחה
    (tabs)/index.tsx        # 🏠 בית
    (tabs)/claims.tsx       # 📋 תביעות
    (tabs)/capture.tsx      # 📷 צלם
    (tabs)/coverage.tsx     # 🛡 כיסויים (חיפוש)
    (tabs)/family.tsx       # 👨‍👩‍👧 משפחה
    receipt/[id].tsx        # [K] בדיקת קבלה
    claim/new.tsx           # [L] מסלול הכסף + הגשה
    claim/[id].tsx          # [M] מעקב + [N] הכסף הגיע + דחייה
    settings.tsx            # הגדרות, פרטיות, מחיקה
  src/
    api/                    # client (fetch + refresh), hooks (TanStack Query)
    state/                  # zustand: auth
    ui/                     # רכיבים: Button, Card, MoneyText, Screen, Chip, Timeline...
    theme.ts                # צבעים, טיפוגרפיה, מרווחים
    i18n/he.ts              # כל הטקסטים
    format.ts               # כסף (₪), תאריכים
```

### 13.2 ניווט ותנאים
- **אין טוקן:** `(auth)/welcome`.
- **יש טוקן, onboarding לא הושלם:** המשך מהשלב האחרון (נשמר בשרת: `me.onboardingStep`).
- **אחרת:** `(tabs)`.
- **Deep links:** `magiali://claim/<id>` מהתראות.

### 13.3 RTL ועברית
- `I18nManager.forceRTL(true)` + `allowRTL(true)`. ב-Expo גם `extra.supportsRTL` ו-`forcesRTL` בקונפיגורציה.
- **כל הטקסטים** ב-`i18n/he.ts`. **סכומים:** `formatILS(agorot)` → "‏1,234.50 ₪" (תו כיווניות).
- **אייקוני כיוון** (חצים) משתקפים.

### 13.4 עיצוב (Design tokens)
| Token | ערך |
|-------|-----|
| `primary` | `#0F766E` (טורקיז כהה, "כסף ובריאות") |
| `money` | `#15803D` (ירוק: סכומים שהגיעו) |
| `warning` | `#B45309` |
| `danger` | `#B91C1C` |
| `bg` / `surface` / `text` / `muted` | `#F8FAFC` / `#FFFFFF` / `#0F172A` / `#475569` |
| גופן | מערכת (SF / Roboto), בסיס 17, סכומים 28–40 bold |
| יעדי מגע | 48dp ומעלה, כפתור ראשי 56 |
| רדיוס | 14 |

**מצב כהה:** בשלב v1.1.

### 13.5 מצבים לכל מסך
טעינה (skeleton), ריק (עם פעולה), שגיאה (עם "נסה שוב"), אופליין (באנר עליון ותור העלאות).

### 13.6 העלאת קבלות
- **אופטימיזציה:** כיווץ ל-2000px בצד הארוך, JPEG 0.8. העלאה ברקע, עם חיווי.
- **תור אופליין:** קבלה שצולמה בלי רשת נשמרת מקומית ונשלחת כשחוזר חיבור.

### 13.7 אבטחה במובייל
- **טוקנים ב-`expo-secure-store`.** לא ב-AsyncStorage.
- **נעילה ביומטרית** (אופציונלית, v1.1).
- **מסכים רגישים:** הסתרה בתמונת ה-App Switcher.

---

## 14. ממשק תפעול

**ב-MVP:** Admin API (סעיף 9.8), ובנוסף סקריפטים. **בשלב v1.1:** ממשק ווב פנימי עם תור משימות (שלבים שממתינים לעדכון, מחלוקות על עמלות, קבלות שהחילוץ שלהן נכשל).

---

## 15. סביבות, פריסה ו-CI/CD

| סביבה | שרת | DB | מובייל |
|-------|-----|----|--------|
| **dev** | `npm run dev -w apps/server` | Postgres מקומי | Expo Go או dev build |
| **staging** | קונטיינר (Fly.io / Render / AWS ECS) | Postgres מנוהל | EAS "preview" (TestFlight / Internal testing) |
| **prod** | אותו קונטיינר, 2+ עותקים + worker | Postgres מנוהל עם גיבוי PITR | EAS "production" ← App Store / Google Play |

- **CI (GitHub Actions):** על כל PR: `npm ci` ← typecheck לכל ה-workspaces ← tests (עם שירות Postgres).
- **CD:** merge ל-main ← build image ← staging. Release tag ← prod. מיגרציות רצות ב-startup (נעילת advisory).
- **מובייל:** `eas build --profile production` ← `eas submit`. עדכוני JS דרך `eas update` (OTA), רק לשינויים שאינם native.
- **דרישות חנויות:** מדיניות פרטיות, הצהרת נתונים (Data Safety / Privacy Nutrition), הסבר על שימוש במצלמה ובתמונות, אפשרות מחיקת חשבון **בתוך האפליקציה** (דרישה של Apple ו-Google).

---

## 16. בדיקות

| שכבה | מה נבדק | כלי |
|------|---------|-----|
| **יחידה** | מנוע כללים (כל המקרים ב-5.4), עמלות, מעברי סטטוס, פורמט כסף | Vitest |
| **אינטגרציה (שרת)** | זרימת OTP ← משק בית ← שיוכים ← קבלה ← תביעה ← הגשה ← עדכוני שלבים ← עמלה. הרשאות בין משקי בית. Jobs | Vitest + Postgres אמיתי + Fastify `inject` |
| **חוזה** | סכמות zod משותפות | typecheck |
| **מובייל** | typecheck, ובדיקת רינדור של מסכי מפתח (בהמשך: Maestro E2E) | tsc, Expo |
| **ידני** | צילום בתנאים שונים, קורא מסך (VoiceOver / TalkBack), טקסט גדול 200% | — |

---

## 17. תצפיתיות

- **לוגים מובנים** (pino) עם `requestId`. **בלי** מידע אישי (מיסוך טלפון, בלי סכומים בהקשר מזהה).
- **מדדים:** זמן חילוץ, שיעור כישלון חילוץ, עלות Claude לקבלה, תביעות לפי סטטוס, זמן לתשלום לפי גוף, הצלחת חיובים.
- **שגיאות:** Sentry (שרת ומובייל) עם סינון PII.
- **Health:** `GET /health` (DB + גרסה).

---

## 18. תוכנית שחרור

| שלב | זמן | תוכן |
|-----|-----|------|
| **Alpha פנימי** | חודש 1–2 | כל זרימת ה-MVP, קטלוג של 4 שב"נים × 2 רמות + 3 מבטחים (כלל, הראל, הפניקס), עדכון סטטוס ידני |
| **Beta סגורה (50 משפחות)** | חודש 3 | קונסיירז' + אפליקציה: מדידת ₪ למשפחה, אישור ועמלות |
| **השקה** | חודש 4 | חנויות, חוות דעת משפטית, ממונה פרטיות |
| **v1.1** | חודש 5–6 | חיפוש במייל, כל המבטחים, ממשק תפעול בווב, מצב כהה, ביומטרי |
| **v2** | חודש 7–12 | ערוץ מעסיקים, מנוי משפחתי, שותפויות הפצה |
| **v3** | שנה 2 | רישיון שירות מידע פיננסי, אינטגרציות API עם גופים |

---

## 19. נספחים

### 19.1 קטלוג ראשוני (seed, להמחשה)
> **⚠️ הערכים בקטלוג ה-seed הם להמחשה ולבדיקות בלבד.** לפני ההשקה צוות התפעול מזין ערכים מאומתים מתקנוני השב"ן ומנספחי הפוליסות, וכל ערך מתועד עם מקור.

תוכניות: `clalit_mushlam`, `clalit_platinum`, `maccabi_zahav`, `maccabi_sheli`, `meuhedet_adif`, `meuhedet_shia`, `leumit_kesef`, `leumit_zahav`, `harel_ambulatory`, `clal_ambulatory`, `phoenix_ambulatory`, `group_generic`.

שמות רמות השב"ן: כללית (מושלם, מושלם פלטינום), מכבי (זהב, שלי), מאוחדת (עדיף, שיא), לאומית (כסף, זהב).

### 19.2 קודי שגיאה
| code | HTTP | משמעות |
|------|------|--------|
| `validation_error` | 400 | קלט לא תקין |
| `unauthorized` | 401 | אין טוקן או שהוא לא תקין |
| `forbidden` | 403 | אין הרשאה למשאב |
| `not_found` | 404 | |
| `conflict` | 409 | מעבר סטטוס לא חוקי, או משאב בשימוש |
| `rate_limited` | 429 | |
| `otp_invalid` / `otp_expired` / `otp_locked` | 400 | |
| `consent_required` | 403 | בן משפחה בגיר שלא אישר |
| `internal` | 500 | |

---

## 20. שירותים חיצוניים, תפעול ומשימות יומיות

### 20.1 ספקים
השרת בוחר ספק לפי משתני הסביבה (`apps/server/src/wiring.ts`). אם חסרים פרטי גישה, רץ מימוש הפיתוח. המדריך המלא, כולל המכסות החינמיות: [free-services.md](free-services.md).

| ממשק | ייצור | פיתוח והדגמה |
|------|-------|--------------|
| `SmsProvider` | Twilio (`TWILIO_*`) | הדפסה ללוג, וקוד קבוע `OTP_DEV_CODE` |
| `EmailProvider` | Resend (`RESEND_API_KEY`, `EMAIL_FROM`) | הדפסה ללוג |
| `StorageProvider` | S3 / Cloudflare R2 (`S3_*`). התוכן מוצפן לפני השמירה | דיסק מקומי |
| `PaymentProvider` | סולק ישראלי (Grow / PayPlus / Cardcom), אחרי פתיחת חשבון סוחר | מדומה. טוקן `fail_…` נדחה |
| `PushProvider` | Expo Push | Expo Push |
| `ReceiptExtractor` | Claude (`ANTHROPIC_API_KEY`) | הקלדה ידנית |

חיבור למסד הנתונים: אם ב-`DATABASE_URL` יש `sslmode=require` או `sslmode=verify-full`, החיבור מוצפן (TLS). זה נדרש, למשל, ב-Neon.

### 20.2 ממשק תפעול (`/ops`)
דף עברי אחד שהשרת מגיש. הגישה עם `ADMIN_TOKEN`, והטוקן נשמר רק בלשונית הנוכחית (sessionStorage).
- **מונים:** משתמשים, כסף שהוחזר, תביעות ומקטעים לפי מצב, ומשימות שנכשלו.
- **תור עבודה:** מקטעים לפי מצב (מוכן / הוגש / בבדיקה / אושר). לכל מקטע: מי, מה, סכום צפוי וטלפון בעל משק הבית. הכפתורים מעבירים מצב: הוגש ← התקבל ← בבדיקה ← אושר ← 💸 שולם (עם סכום), או נדחה (עם סיבה). כל מעבר עובר דרך `transitionLeg`, אז ההתראות, המקטע הבא והעמלה קורים כמו בייצור.
- **עמלות:** "חייב עכשיו" (`charge_now`) מדלג על 3 ימי ההמתנה, ומיועד להדגמה ולמקרים חריגים. "חייב" ו"וותר" מכריעים בעמלה במחלוקת או בעמלה שנכשלה.
- **משימות שנכשלו:** סוג, ניסיונות ושגיאה אחרונה.
- API: `GET /admin/overview`, `GET /admin/legs?status=a,b`, `POST /admin/legs/:id/status`, `GET /admin/fees`, `POST /admin/fees/:id/resolve {action: charge|waive|charge_now}`, `GET /admin/jobs/failed`, `POST /admin/catalog/publish`.

### 20.3 משימה יומית (`daily_maintenance`, 06:00 UTC)
המשימה מתזמנת את עצמה מחדש. בהפעלת השרת `ensureDailyMaintenance` מוודא שיש בדיוק משימה פתוחה אחת.
- **התראת התיישנות:** לקבלה שלא נתבעה, 60 יום ו-14 יום לפני שעוברות 3 שנים מתאריך השירות (תקופת ההתיישנות בביטוח). כל התראה נשלחת פעם אחת בלבד, לפי מפתח בשדה `data`.
- **גוף משלם איטי:** מקטע שהוגש ועבר את זמן הטיפול הממוצע של הגוף המשלם (`avg_processing_days`) מקבל התראה עם הצעה לבירור, פעם אחת למקטע.

### 20.4 סביבת הדגמה
- `GET /v1/public-config` מחזיר `{demoMode, demoLoginCode}`. האפליקציה מציגה באנר "סביבת הדגמה" ומאפשרת למלא את הקוד בלחיצה.
- `OTP_DEV_CODE` לא מתקבל כש-`NODE_ENV=production`.

### 20.5 ייבוא מהר הביטוח
- **אין התחברות בשם המשתמש.** להר הביטוח אין ממשק פתוח לצד שלישי, ושימוש בפרטי ההזדהות של המשתמש אסור. המשתמש מוריד בעצמו את הדוח מ-harb.cma.gov.il ומעלה אותו.
- **פורמטים:**
  - Excel (xlsx) ו-CSV נקראים באופן דטרמיניסטי, לפי זיהוי עמודות בעברית.
  - צילום מסך ו-PDF נקראים ב-AI, רק עם הסכמת `ai_processing`.
  - xls ישן נדחה, עם הסבר איך להמיר.
- **סיווג:** כל שורה מסווגת כרלוונטית (אמבולטורי, ייעוץ ובדיקות, ילד, רפואה משלימה), כ"אולי", או כלא רלוונטית לקבלות (ניתוחים, תרופות, סיעוד, חיים), עם הסבר.
- **התאמה לקטלוג:** לפי חברה וסוג מוצר. ביטוח קבוצתי מותאם ל-`group_<חברה>`. אם החברה זוהתה אבל המוצר לא, מותאם ל-`<חברה>_health` (המשתמש מזין תנאים). חברה לא מוכרת: המשתמש מקבל הודעה.
- **שני שלבים:** תצוגה מקדימה (`POST /v1/coverage/import`), שבה לא נשמר כלום והקובץ לא נשמר. אחר כך החלה (`POST /v1/coverage/import/apply`) על בני המשפחה שנבחרו, עם `source = har_habituach`, מספר פוליסה מוצפן ותקופת תוקף.
- **השב"ן** לא מופיע בהר הביטוח, ונבחר במסך הכיסויים.
- **שמירת כיסויים** מסנכרנת ולא מוחקת מחדש, כך שתנאים שהמשתמש הזין ונתונים מיובאים נשמרים.
- **בהמשך:** חיבור ישיר דרך רישיון "נותן שירות מידע פיננסי" (חוק שירות מידע פיננסי).

### 20.6 סקירת זכאות מלאה ("כל מה שמגיע לכם")
- `GET /v1/coverage/summary`: לכל בן משפחה ולכל שירות מכוסה:
  - **דוגמה בשקלים:** על ביקור במחיר טיפוסי (`TYPICAL_PRICE_AGOROT`), כמה חוזר ומאיזה גוף. החישוב רץ דרך מנוע הכללים, עם הניצול של השנה הנוכחית.
  - **מה נשאר השנה:** מפגשים ותקרה, לכל ביטוח.
  - **אילו מסמכים צריך.**
- **בנוסף, ברמת משק הבית:**
  - ביטוחים שעוד אין להם תנאים (צריך להזין מהפוליסה).
  - שירותים נפוצים שאין להם כיסוי בכלל.
  - כסף שכבר מחכה: קבלות שלא נתבעו, ותביעות בדרך.
- `POST /v1/coverage/estimate`: הערכה ל-3 השנים האחרונות. המשתמש מזין כמה פעמים שילם ובערך כמה. הביקורים מתחלקים על פני 3 השנים, והכללים האמיתיים רצים שנה אחר שנה, כך שמכסות ותקרות שנתיות נכנסות לחישוב. זו הערכה, והקבלות הן שקובעות.
- **באפליקציה:** מסך `/entitlements`, עם כניסה מהבית, מלשונית "מה מגיע לי" ומסיום ייבוא מהר הביטוח, ואפשרות לשתף סיכום.

### 20.7 הכסף הבריאותי שלנו (`/money`)
- `GET /v1/money?range=year|3y`: מסך אחד שעונה על "איפה הכסף שלנו על בריאות". מבוסס על הקבלות, התביעות והביטוחים שכבר באפליקציה.
- **סיכום:** כמה שילמנו בתקופה, כמה חזר וכמה בדרך, ופס התקדמות.
- **🟠 פספסנו** (כסף שעוד אפשר להשיג):
  - קבלות שלא נתבעו, עם החזר משוער מהמנוע. קבלה שנשארו לה פחות מ-90 יום מ-3 השנים מסומנת כדחופה ומופיעה ראשונה.
  - קבלות שמחכות לפרטים.
  - תשלומים מפירוט האשראי שאין להם קבלה (סעיף 20.8).
  - החזרים שנדחו.
- **🟢 מחכה לנו:** תביעות שחסר בהן מסמך, תביעות מוכנות להגשה ותביעות בטיפול.
- **🔵 אפשר לחסוך:**
  - מכסה שלא נוצלה. מוצג רק לשירות שהמשפחה באמת משתמשת בו, ומתומחר לפי המחיר הממוצע שהיא משלמת.
  - הוצאות על שירות בלי כיסוי.
  - שירותים שבהם חוזר פחות מ-30% (מעל ₪500).
  - ביטוחים בלי תנאים.
  - **מידע בלבד:** אין המלצה לרכוש או לבטל ביטוח.
- **השירותים שלנו:** לכל בן משפחה × שירות בתקופה: ביקורים, ששולם, שחזר, בדרך, ועוד אפשר לקבל.
- כל פריט מוביל לפעולה אחת: לקבלה, לתביעה, להזנת תנאים או לצילום קבלה.

### 20.8 סריקת פירוט כרטיס האשראי (`/scan-card`)
- המשתמש מוריד בעצמו את פירוט העסקאות מחברת האשראי או מהבנק ומעלה אותו (`POST /v1/statement-scan`). **אין התחברות בשם המשתמש, והקובץ לא נשמר.**
- **פורמטים:**
  - Excel ו-CSV נקראים באופן דטרמיניסטי, לפי כותרות בעברית (ישראכרט, מקס, כאל, בנקים). כשיש גם סכום עסקה מלא וגם סכום חיוב (תשלומים), נלקח הסכום המלא.
  - PDF וצילום מסך נקראים ב-AI, רק עם `ai_processing`.
- **זיהוי תשלום רפואי:**
  - מילות מפתח לפי סוג שירות (ד"ר, מכון, פיזיו, קלינאית תקשורת, אופטיקה ועוד) או קטגוריית "רפואה/בריאות" של חברת האשראי.
  - החרגות: בתי מרקחת, קופות החולים, חברות ביטוח, כושר וספא.
  - זיכויים והחזרים לא נכללים, ועסקאות מעל 3 שנים מסוננות.
- **התאמה:** עסקה שיש לה קבלה באפליקציה (אותו סכום, ±₪1, ותאריך ±7 ימים) מסומנת "כבר יש קבלה".
- **שמירה:** המשתמש בוחר אילו תשלומים לשמור כתזכורת (`POST /v1/payment-leads`). נשמרים רק בית העסק, התאריך, הסכום והסוג.
  - התזכורת נסגרת מעצמה כשמצלמים קבלה מתאימה, או ידנית ("לא רלוונטי", `POST /v1/payment-leads/:id/dismiss`).
  - כלולה בייצוא ובמחיקת החשבון.

### 20.9 לפני שקובעים תור, ותזכורות מכסה (`/before-booking`)
- `POST /v1/before-booking` מקבל בן משפחה, שירות, מספר מפגשים, ועד 3 מקומות להשוואה (פרטי במחיר שהמשתמש קיבל, או "בהסדר" עם ההשתתפות העצמית שבירר). בלי מקומות: ביקור פרטי במחיר שהמשפחה שילמה בממוצע, או במחיר טיפוסי.
- **לכל מקום:** כמה משלמים, כמה חוזר (מנוע הכללים עם הניצול של השנה) וכמה עולה בפועל. הזול ביותר מסומן "הכי משתלם".
- **תקרת ההחזר:** המחיר שמעליו ההחזר לביקור כבר לא גדל (תקרה לביקור או סכום קבוע). מחושב בחיפוש בינארי על המנוע.
- **מכסה:** מה נשאר השנה בכל ביטוח, ומתי מתחדשת אם נוצלה.
- **מה להכין:** הפניה מרופא משפחה (כשביטוח דורש), סיכום ביקור, קבלה על שם המטופל, סדר ההגשה, ואזהרה כשמבקשים יותר מפגשים ממה שנשאר. תמיד מידע בלבד, בלי המלצה על ביטוח.
- **תזכורות סוף שנה** (`remindUnusedQuotas`, במשימה היומית): ב-15 בנובמבר וב-5 בדצמבר, התראה אחת לכל משק בית עם המכסות שנשארו לשירותים שהמשפחה **באמת השתמשה בהם** ב-12 החודשים האחרונים, ושוויין לפי המחיר שהיא משלמת. ההתראה פותחת את "הכסף הבריאותי שלנו". פריט "מכסה שלא נוצלה" שם מוביל למסך "לפני שקובעים תור".

### 20.10 מה הביטוחים נותנים לנו (`/premiums`)
- **פרמיה חודשית לכל ביטוח** (`enrollments.monthly_premium_agorot`):
  - נקראת מדוח הר הביטוח כשהוא כולל עמודת פרמיה. פרמיה שנתית מחולקת ב-12.
  - בפוליסה משפחתית הפרמיה נשמרת פעם אחת, על בן המשפחה הראשון שנבחר.
  - אפשר להזין או לעדכן ידנית (`PUT /v1/members/:id/enrollments/:planId/premium`). דמי השב"ן מוזנים ידנית.
  - כלולה בייצוא המידע.
- `GET /v1/premiums`: לכל ביטוח ב-12 החודשים האחרונים:
  - כמה שולם, לפי הפרמיה החודשית ורק בחודשים שהביטוח היה פעיל.
  - כמה החזיר בפועל (מקטעים ששולמו) וכמה בדרך.
  - באילו שירותים השתמשנו, וכמה סוגי שירות הוא מכסה.
- **שירותים ששני ביטוחים פרטיים מכסים לאותו אדם:** מוצג כעובדה, עם ההסבר שההחזר הכולל לא עולה על ההוצאה.
- **מידע בלבד:**
  - ההשוואה כוללת רק החזרים על קבלות, ולא אירועים גדולים כמו ניתוחים ותרופות.
  - אין המלצה לבטל או לרכוש.
  - יש הפניה לבעל רישיון, עם תקופת אכשרה, חיתום והחרגות כעובדות.

## 21. סטטוס מימוש (אוקטובר 2026)

| רכיב | מצב | הערות |
|------|-----|-------|
| `packages/shared`: מנוע כללים, עמלות, מכונת מצבים, סכמות | ✅ | 32 בדיקות. ביטוח פרטי רגיל מחושב על כל ההוצאה, ועד היתרה שנשארה אחרי השב"ן |
| שרת: כל ה-API, עבודות רקע, תפעול | ✅ | 90 בדיקות אינטגרציה מול Postgres |
| ספקים אמיתיים: Twilio, Resend, R2/S3, **Cardcom** (טוקן, חיוב, קבלה, החזר), Claude, Sentry | ✅ | נבחרים לפי משתני סביבה. מצב ייצור מסרב לרוץ עם ספק מדומה |
| קטלוג כיסויים | ✅ מחקרי | מקור ורמת ודאות לכל ערך. המשתמש יכול להתאים לפוליסה שלו. [catalog-review.md](catalog-review.md) |
| משפטי ופרטיות: מסמכים, הסכמות נפרדות (opt-in), הודעה לפי סעיף 11, מחיקה לפי מדיניות שמירה, הצהרת הורה/אפוטרופוס | ✅ טיוטות | לבדיקת עורך דין. [compliance/](compliance/) |
| ממשק תפעול עם כניסה אישית לכל איש צוות | ✅ | `OPS_PHONES` |
| ייבוא מהר הביטוח (Excel, CSV, PDF, צילום מסך) | ✅ | סעיף 20.5 |
| סקירת זכאות מלאה והערכה ל-3 שנים | ✅ | סעיף 20.6 |
| הכסף הבריאותי שלנו (פספסנו / מחכה לנו / אפשר לחסוך) | ✅ | סעיף 20.7 |
| סריקת פירוט כרטיס האשראי | ✅ | סעיף 20.8 |
| לפני שקובעים תור, ותזכורות מכסה בסוף השנה | ✅ | סעיף 20.9 |
| מה הביטוחים נותנים לנו (פרמיות מול החזרים, כפל כיסוי) | ✅ | סעיף 20.10 |
| אפליקציה: כל המסכים, מיתוג, אייקונים ומסך פתיחה | ✅ | E2E בדפדפן על כל הזרימה, כולל דף הסליקה וממשק התפעול |
| בדיקה מול מסוף Cardcom אמיתי | ⏳ | סביבת הפיתוח חסומה לאתר Cardcom. נבדק מול סימולציה לפי ה-OpenAPI הרשמי |
| חשבונות, פרטי עסק, DPA, עורך דין, חנויות | ⏳ | בעל העסק. [production.md](production.md) |
| `member_access` (כמה משתמשים מנהלים משק בית אחד) | ⏳ | אחרי ההשקה |

</div>
