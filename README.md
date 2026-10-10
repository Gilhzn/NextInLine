# מגיע לי (NextInLine)

> **"צלם קבלה ותקבל כסף. אנחנו נדע ממי, באיזה סדר וכמה."**
>
> אפליקציה ל-iOS ול-Android שמוצאת, מגישה ועוקבת אחרי החזרים רפואיים מהשב"ן ומביטוחי בריאות פרטיים.

## מסמכים

| מסמך | תוכן |
|------|------|
| 📘 [איפיון מלא](docs/full-spec.md) | מוצר, UX, צד שרת, מודל נתונים, API, אבטחה ופריסה. **המסמך המחייב לפיתוח** |
| 🧩 [ניתוח מתחרים ואיפיון UX](docs/magia-li-competitors-and-ux.md) | מתחרים בישראל ובעולם, פרסונות ומסכים |
| ⚖️ [רגולציה והיקף כספי](docs/regulation-and-market-size.md) | בדיקת היתכנות משפטית וגודל השוק |
| 💡 [החור בשוק](docs/market-gap-idea.md) | הרעיון |
| 🧭 [בחינת רעיונות](docs/idea-evaluation.md) · 📄 [איפיון ציד תורים](docs/product-spec.md) | רעיונות קודמים |

## 🚀 לנסות את האפליקציה ב-GitHub (בלי להתקין כלום)

### אפשרות א': Codespaces (האפליקציה רצה, ואתה משתמש בה בדפדפן)
1. בעמוד הריפו ב-GitHub: **Code** ← לשונית **Codespaces** ← **Create codespace on `<הענף>`**.
2. מחכים כמה דקות להקמה (ההקמה הראשונה כוללת התקנה ובנייה).
3. הפקודה `npm run demo` רצה אוטומטית ומרימה מסד נתונים, שרת ואפליקציה על כתובת אחת. כשהיא מוכנה, הדפדפן נפתח לבד (או: לשונית **Ports** ← פורט 4000 ← 🌐).
4. נכנסים עם כל מספר נייד ישראלי, ו**קוד הכניסה הוא 123456**.

> כדי לפתוח מהטלפון: בלשונית Ports, קליק ימני על 4000 ← **Port Visibility ← Public**, ואז פותחים את הכתובת בטלפון.
> זו סביבת הדגמה: SMS, סליקה ומיילים מדומים, ונתוני הכיסוי הם להמחשה בלבד.

### אפשרות ב': GitHub Actions (בדיקה אוטומטית עם צילומי מסך)
בכל push, GitHub מריץ את כל הבדיקות, מרים את השרת והאפליקציה ועובר על כל הזרימה בדפדפן אמיתי. צילומי המסך נשמרים בלשונית **Actions** ← הריצה האחרונה ← **Artifacts ← app-screenshots**.

### מקומית, בפקודה אחת
```bash
npm install && npm run demo     # צריך PostgreSQL פעיל. ואז http://localhost:4000
```

## מבנה הקוד

```
packages/shared   טיפוסים, סכמות zod, מנוע כללי הכיסוי, חישוב עמלה, מכונת מצבים של תביעה
apps/server       Fastify + PostgreSQL: API, עבודות רקע, חילוץ קבלות עם Claude, הצפנה
apps/mobile       Expo (React Native): אפליקציה אחת ל-iOS ול-Android, עברית ו-RTL
```

## הרצה מקומית

**דרישות:** Node.js 22 ו-PostgreSQL 16.

```bash
npm install

# מסד נתונים
createdb magiali            # או: psql -c "CREATE DATABASE magiali"

# שרת (מריץ מיגרציות וזורע את קטלוג הכיסויים אוטומטית)
cp apps/server/.env.example apps/server/.env
#   ← למלא את MASTER_KEY:  openssl rand -base64 32
#   ← לא חובה: ANTHROPIC_API_KEY לחילוץ אוטומטי של קבלות (בלעדיו ממלאים את הקבלה ידנית)
npm run dev:server          # http://localhost:4000 · קוד כניסה בפיתוח: 123456

# אפליקציה
cp apps/mobile/.env.example apps/mobile/.env
#   ← בטלפון אמיתי: EXPO_PUBLIC_API_URL=http://<ה-IP של המחשב>:4000
npm run dev:mobile          # סריקת QR עם Expo Go, או a/i לאמולטור
```

## בדיקות

```bash
npm run typecheck           # כל ה-workspaces
npm test                    # מנוע הכללים + בדיקות אינטגרציה מול Postgres אמיתי
```

בדיקות השרת יוצרות מסד נתונים זמני לכל קובץ בדיקה. כתובת ברירת המחדל היא `postgres://magiali:magiali@localhost:5432/postgres`, ואפשר לשנות אותה עם `TEST_DATABASE_URL`.

## בנייה והפצה

| יעד | פקודה |
|-----|-------|
| שרת (קונטיינר) | `docker build -f apps/server/Dockerfile -t magiali-server .` |
| שרת (בלי Docker) | `npm run build -w @magiali/server && node apps/server/dist/index.js` |
| אפליקציה, build לפיתוח | `cd apps/mobile && npx eas-cli@latest build --profile development` |
| אפליקציה לחנויות | `npx eas-cli@latest build --profile production` ואחר כך `npx eas-cli@latest submit` |

`ROLE=api|worker|all` קובע אם תהליך מגיש HTTP, מריץ עבודות רקע, או את שניהם.

## מה עוד חסר לפני השקה

הקוד מגדיר ממשק לכל שירות חיצוני. כרגע רצים מימושי פיתוח:

| שירות | מצב נוכחי | לייצור |
|-------|-----------|--------|
| SMS | מודפס ללוג | ספק SMS ישראלי (`SmsProvider`) |
| סליקה | `MockPayments` | ספק סליקה עם טוקניזציה (`PaymentProvider`) ו-SDK במובייל |
| אחסון קבצים | דיסק מקומי (מוצפן) | דלי S3 (`StorageProvider`) ומפתח ראשי ב-KMS |
| מייל להגשה | מודפס ללוג | SES/SMTP (`EmailProvider`) |
| פוש | Expo Push | צריך `extra.eas.projectId` (נוצר עם `eas init`) |
| קטלוג כיסויים | **ערכי המחשה בלבד** | הזנת ערכים מאומתים מתקנוני השב"ן ונספחי הפוליסות, עם מקור |

ובנוסף: חוות דעת משפטית (ראו מסמך הרגולציה), מדיניות פרטיות ותנאי שימוש, ממונה הגנת פרטיות, ואייקונים ומסך פתיחה ממותגים.
