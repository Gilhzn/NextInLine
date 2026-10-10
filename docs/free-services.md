<div dir="rtl">

# שירותים חיצוניים בחינם: מה לחבר ואיך

> נבדק באוקטובר 2026. מחירים ומכסות משתנים, אז כדאי לבדוק בקישור לפני שמסתמכים עליהם.

השרת בוחר ספק אוטומטית לפי משתני הסביבה. אם משתנה לא מוגדר, רץ מימוש הפיתוח (הדפסה ללוג או דיסק מקומי), ככה שכל שירות אפשר לחבר בנפרד. בהפעלה השרת כותב ללוג באילו שירותים הוא משתמש, למשל:

```
services: sms=twilio · email=console (dev) · storage=s3 (receipts) · payments=mock (dev) · extraction=claude · push=expo
```

## סיכום

| צורך | המלצה | חינם? | משתני סביבה |
|------|-------|-------|-------------|
| SMS (קוד כניסה) | **Twilio** (trial) | קרדיט ניסיון של כ-15$, ושליחה רק למספרים מאומתים | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` או `TWILIO_MESSAGING_SERVICE_SID` |
| SMS, חלופות | SMS.to, EasySendSMS, SMSmode, Vonage | קרדיט ניסיון קטן (15–20 הודעות, או 2€) | צריך מתאם (ראו למטה) |
| מייל (שליחת תיק לחברת ביטוח) | **Resend** | 3,000 מיילים בחודש, עד 100 ביום, לתמיד | `RESEND_API_KEY`, `EMAIL_FROM` |
| אחסון קבלות | **Cloudflare R2** | 10GB, בלי תשלום על הורדות | `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| מסד נתונים | **Neon** | 0.5GB, בלי תאריך תפוגה | `DATABASE_URL=...?sslmode=require` |
| התראות Push | **Expo Push** | חינם | אין (מובנה) |
| ניטור שגיאות | Sentry | 5,000 שגיאות בחודש | (לא מחובר עדיין) |
| סליקה | Grow / PayPlus / Cardcom | סביבות בדיקה בלבד | (מדומה, ראו למטה) |
| קריאת קבלות ב-AI | Anthropic (Claude) | **בתשלום**, לפי שימוש | `ANTHROPIC_API_KEY` |

## SMS

**אין שירות SMS חינמי לתמיד.** כולם נותנים קרדיט ניסיון. בגלל זה סביבת ההדגמה משתמשת בקוד קבוע (`OTP_DEV_CODE=123456`) ולא שולחת SMS בכלל.

### Twilio (מחובר בקוד)
1. נרשמים ב-twilio.com ומקבלים קרדיט ניסיון.
2. ב-Console מעתיקים את **Account SID** ואת **Auth Token**.
3. **בחשבון ניסיון אפשר לשלוח רק למספרים מאומתים:** Phone Numbers → Verified Caller IDs → מוסיפים את הנייד שלכם.
4. שולח: לישראל אפשר שם אלפאנומרי, למשל `MagiaLi` (עד 11 תווים, באנגלית), או מספר Twilio שקונים בקרדיט.
5. מגדירים ב-Render → Environment: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
6. **מוחקים את `OTP_DEV_CODE`.** כל עוד הוא מוגדר הקוד נשאר 123456 בכל כניסה.

### חלופות (צריך לכתוב מתאם של כ-30 שורות, באותו מבנה כמו `TwilioSms` ב-`apps/server/src/providers.production.ts`)
- **SMS.to:** קרדיט ניסיון ומחירון לישראל: https://sms.to/gateway/israel
- **EasySendSMS:** 15 הודעות ניסיון: https://www.easysendsms.com/gateway/Israel
- **SMSmode:** 20 הודעות ניסיון: https://www.smsmode.com/en/free-sms-api/
- **Vonage:** קרדיט ניסיון של 2€.
- סקירה: https://publicapis.io/blog/free-sms-apis

> לייצור בישראל כדאי לבחור ספק מקומי עם שם שולח מאושר (למשל 019, InforU או Cellact). אחרי ההחלטה מוסיפים מתאם.

## מייל: Resend
1. נרשמים ב-resend.com ויוצרים API Key.
2. בלי דומיין מאומת אפשר לשלוח רק לכתובת שאיתה נרשמתם, מהכתובת `onboarding@resend.dev`. כדי לשלוח לכל כתובת מאמתים דומיין (רשומות DNS).
3. מגדירים: `RESEND_API_KEY` ו-`EMAIL_FROM` (למשל `מגיע לי <claims@your-domain.co.il>`).
- מכסות: https://resend.com/docs/knowledge-base/account-quotas-and-limits

## אחסון קבלות: Cloudflare R2
**למה צריך את זה ב-Render:** הדיסק של שירות חינמי ב-Render נמחק בכל פריסה או הפעלה מחדש, ואיתו תמונות הקבלות. R2 שומר אותן לתמיד.
1. ב-Cloudflare → R2 → Create bucket (למשל `magiali-receipts`).
2. R2 → Manage API Tokens → Create token עם הרשאות Object Read & Write לבאקט.
3. מגדירים:
   - `S3_BUCKET=magiali-receipts`
   - `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
   - `S3_REGION` לא חובה (ברירת המחדל היא `auto`)
- הקבצים מוצפנים בשרת (AES-256-GCM) לפני שהם נשמרים, אז גם Cloudflare לא רואה את תוכן הקבלות.
- עובד גם עם AWS S3, Backblaze B2 ו-MinIO.

## מסד נתונים: Neon
**למה:** מסד הנתונים החינמי של Render **פג אחרי 30 יום**. ב-Neon החינמי אין תאריך תפוגה (0.5GB, ונכבה כשאין שימוש).
1. נרשמים ב-neon.tech → New Project (אזור Frankfurt, קרוב לשרת).
2. מעתיקים את ה-Connection string.
3. ב-Render → Environment מחליפים את `DATABASE_URL` במחרוזת של Neon. היא צריכה להסתיים ב-`?sslmode=require`.
4. השרת מריץ את המיגרציות לבד בהפעלה הראשונה.

## סליקה (עמלת ההצלחה)
הסליקה **נשארת מדומה** בהדגמה. כרטיס שמתחיל ב-`fail_` נדחה, וכל כרטיס אחר מצליח. לחיבור אמיתי בוחרים סולק ישראלי, ולכל אחד יש סביבת בדיקה:
- **Grow (Meshulam):** כרטיסי בדיקה. ל-Bit, Apple Pay ו-Google Pay אין סביבת בדיקה: https://developers.grow.business/reference/testing-environment
- **PayPlus:** סביבת staging: https://www.payplus.co.il/developers
- **Cardcom:** sandbox: https://www.cardcom.solutions/developers
- השוואה: https://otomation.io/blog/israeli-payment-gateways-api

הגישה לסביבת בדיקה לרוב דורשת פתיחת חשבון סוחר, אז מחברים אחרי שבוחרים סולק. בקוד מממשים את הממשק `PaymentProvider` (בקובץ `apps/server/src/providers.ts`), כלומר שמירת טוקן (tokenization) וחיוב עם idempotency key.

## Anthropic (קריאת קבלות)
בתשלום לפי שימוש. בלי מפתח, המשתמש מקליד את פרטי הקבלה בעצמו והזרימה עובדת במלואה. עם `ANTHROPIC_API_KEY` הקבלה נקראת אוטומטית והשדות שהמודל לא בטוח בהם מסומנים.

</div>
