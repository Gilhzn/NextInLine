# Private ambulatory coverage (הראל, כלל, הפניקס, מגדל): research notes

> Researched 2026-10-10. Scope: the main **individual** ambulatory products ("ייעוץ ובדיקות" riders plus the related service letters / add-ons) sold in 2024–2026, plus a short note on group (קולקטיב) policies.
> Amounts in rule JSON are **agorot** (₪ × 100). The JSON shape matches `benefitRuleSchema` in `packages/shared/src/rules.ts`. Where a value could not be confirmed, it is `null`, **including `percent`**. Such a rule will fail the schema's `refine` on purpose: it can't be seeded until the user's own policy fills it in.

## 0. How this was researched (read this first)

- **No primary document could be opened directly.** This session's egress policy blocked every insurer host (`harel-group.co.il`, `media.harel-group.co.il`, `clalbit.co.il`, `fnx.co.il`, `digital-content.fnx.co.il`, `migdal.co.il`, the Migdal blob store `storageblobwebprod.blob.core.windows.net`, `gov.il`, `kolzchut.org.il`). `curl` got a 403 at CONNECT and WebFetch got a DNS failure. Only web search worked.
- So every figure below comes from **search-index text of the official PDFs and pages** (often a garbled extraction of RTL PDF tables) or from broker sites. I did not see the full tables myself.
- What the confidence labels mean here:
  - **verified-official**: the figure is tied to the benefit in an official insurer URL's text, and it was consistent across at least 2 independent searches, or it appears on both the product page and the policy PDF. It still needs one manual look at the PDF before production use.
  - **secondary-source**: either from a broker or aggregator site, or from official text whose extraction was ambiguous (number present but its row or column was unclear), or seen only once.
  - **not-found**: no reliable figure was found.
- Hebrew quotes are as returned in the search excerpts. Where I only had an English paraphrase of the official text, the quote is marked *(paraphrase)*.

## 1. Key structural findings

### 1.1 "משלים שב"ן" vs "מהשקל הראשון"
- **The משלים שב"ן / מהשקל הראשון split is a feature of surgery policies** (ניתוחים). It came from the 2016 standardisation of health insurance. None of the four insurers' current **ambulatory "ייעוץ ובדיקות"** riders is sold as "משלים שב"ן". They are indemnity (שיפוי) riders that pay from the first shekel, **but with a non-duplication / "difference" rule when the HMO supplementary plan (שב"ן) also paid**:
  - Harel's claims page and claim form say to claim the שב"ן first, and then Harel pays only the difference: *"מומלץ קודם להגיש תביעה לביטוח המשלים של קופת החולים (שב"ן) ורק אחר כך להגיש תביעה להראל"*; *"בתביעה זו יוחזר ההפרש שבין סכום ההחזר בביטוח המשלים…"*; *"לא ניתן לתבוע החזר בגין אותם סכומים מגורמים שונים"* ([Harel ambulatory claim page](https://www.harel-group.co.il/insurance/health/claim/ambulatory-care), claim guideline PDF 07/2025).
  - Phoenix's older rider 5416 (07/2016) states it explicitly: the insurer's reimbursement plus the שב"ן entitlement together must not exceed the maximum indemnity, so the insurer pays the difference ([nispach_5416_07-16.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/healthinsurance/nispach_5416_07-16.pdf), secondary-source). I could not confirm the same clause for 6782.
- **Exception: a genuinely שב"ן-linked benefit exists.** Migdal's complementary-medicine service letter has a "track C" that pays *"50% מסכום ההשתתפות העצמית ששולמה ע״י המנוי לקופת החולים בפועל, אך לא יותר מ-100 ₪ לכל טיפול"*. It reimburses the HMO co-pay, so it needs proof of the שב"ן payment.

### 1.2 Consequence for the routing engine (important)
`computeRouting` applies a later payer's `percent` to the **remainder** after the שב"ן ("X% מההפרש"). The wording found here suggests insurers usually compute **their own benefit on the full expense** (for example 80% up to ₪800) and then pay **min(that benefit, expense − amount already reimbursed)**.
Example: a ₪1,000 visit where the שב"ן paid ₪600.
- Engine today (Clal 80%/₪800 rule): 80% × 400 = ₪320.
- "Difference" reading: min(min(800, 800), 400) = ₪400.

Phoenix 5416-style wording ("together not above the max indemnity") gives min(cap − שב"ן paid, …), which is a third variant. I recommend adding a per-plan `coordination` field (`percent_of_remainder` | `benefit_capped_by_remainder` | `cap_minus_other_payers`) rather than hard-coding one formula.

### 1.3 Two tracks per benefit (network vs reimbursement)
Every current product has:
- **בהסכם (in-network)**: the member pays a **fixed co-pay directly to the provider** (Harel ₪150, Migdal ₪250 or ₪120, alternative-medicine ₪55). **There is nothing to claim**, because the insurer pays the provider.
- **שלא בהסכם (reimbursement)**: X% of actual cost (or of the Ministry of Health price list, at Migdal) up to a per-event cap, with sub-limits.

The current schema has one rule per category, so the reimbursement track is what matters for a claims app. The in-network rules are recorded below with `deductibleAgorot` = the co-pay, for completeness only.

### 1.4 Shared and nested caps
Caps are often **shared across categories**: Harel 527's ₪20,000 covers "פרקים א' וב' יחד", and Phoenix 6782 has one program-wide annual limit. Caps also come **per test type** (Phoenix: US ₪500 / CT ₪1,500 / MRI ₪4,500 / PET-CT ₪5,000) and with **sub-limits** (psychiatrist consults counted separately). The current schema can't express any of these.

---

## 2. Harel (הראל)

**Main current products:** "ייעוץ ובדיקות" in two tiers, both **edition 09/2024** (renewable every 2 years):
- **Basic**, plan **527**: [P/14924.pdf](https://www.harel-group.co.il/P/14924.pdf). Predecessor: plan 520, ed. 10/2023, [P/14252.pdf](https://www.harel-group.co.il/P/14252.pdf).
- **Extended**, plan **517**: [P/14925.pdf](https://www.harel-group.co.il/P/14925.pdf). Ed. 10/2023: [P/14054.pdf](https://www.harel-group.co.il/P/14054.pdf).
- Product page: [ייעוץ ובדיקות (בסיסי או מורחב)](https://www.harel-group.co.il/insurance/health/policies/ambulatory-care).

How the tiers differ: basic covers consultations **only in Harel's specialist network** (plus defined medical cases). Extended covers *"ייעוצים רפואיים לפי בחירת המבוטח"*. Waiting period: 90 days (12 months for pregnancy tests). Not משלים שב"ן; it uses the difference rule (§1.1).

| Category | Rule (agorot) | Hebrew quote | Source | Confidence |
|---|---|---|---|---|
| specialist_visit, in-network (basic 527 & extended) | `{"percent":100,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":15000,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "ניתן לפנות לייעוץ אצל רופא מומחה שעובד בהסכם עם הראל, בעלות השתתפות עצמית בסך 150 ₪" | [claim page](https://www.harel-group.co.il/insurance/health/claim/ambulatory-care); P/14924.pdf | verified-official |
| second_opinion (basic 527, out-of-network, oncology / neurology / cardiology only) | `{"percent":100,"perSessionCapAgorot":150000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "התשלום עד לסך של 1,500 ₪ לחוות דעת רפואית שניתנה על ידי רופא מומחה לאחד מהתחומים: אונקולוגיה, נוירולוגיה, קרדיולוגיה" | [P/14924.pdf](https://www.harel-group.co.il/P/14924.pdf) | secondary-source (percent=100 is my reading of "עד לסך"; the excerpt also mentions ₪300 for other fields and a ₪700 annual figure, and their rows were unclear) |
| second_opinion / specialist_visit (extended 517, out-of-network) | `{"percent":null,"perSessionCapAgorot":100000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "חוות דעת רפואית … עד סך של 1,000 ₪ לחוות דעת" | [P/14925.pdf](https://www.harel-group.co.il/P/14925.pdf), [P/14054.pdf](https://www.harel-group.co.il/P/14054.pdf) | secondary-source (80% appears nearby but couldn't be attached to this row; no annual count was found) |
| diagnostic_imaging (527) | `{"percent":80,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":2000000,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "אחריותה הכוללת של החברה … עבור כל פרקי הכיסוי יחד, לא תעלה על סך כולל של 20,000 ₪ לכל שנת ביטוח" | [P/14924.pdf](https://www.harel-group.co.il/P/14924.pdf), disclosure 9.2024 | verified-official for 80% and ₪20,000. The cap is **shared with consultations**, and a ₪25,000 cap applies after 60 continuous months. A referral is probably required but wasn't confirmed. |
| lab_tests (527) | same as diagnostic_imaging (shared ₪20,000) | "הכיסוי כולל בדיקות מעבדה, צילומי רנטגן, בדיקת M.R.I" | P/14924.pdf | secondary-source |
| child_development: treatments (plan **521** "טיפולים ואבחונים לילד", ed. 10/2023) | `{"percent":50,"perSessionCapAgorot":30000,"perSessionFixedAgorot":null,"annualCapAgorot":300000,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt","referral"],"minAge":null,"maxAge":21}` | "50% השתתפות עצמית של המבוטח בטיפולים - הכיסוי ניתן עד לגובה של 300 ש"ח לטיפול ועד לסכום מירבי של 3,000 ש"ח לשנת ביטוח" | [product page](https://www.harel-group.co.il/insurance/health/policies/child-development), [P/14253.pdf](https://www.harel-group.co.il/P/14253.pdf) | verified-official. Referral must come from a child-development specialist or pediatric neurologist. maxAge: "עד גיל 21", so check whether that is inclusive. |
| child_development: diagnoses (521) | `{"percent":80,"perSessionCapAgorot":null,...}` | 20% השתתפות עצמית; caps per diagnosis type (ADHD and learning-disability assessments; roughly ₪1,000 and ₪500 in a garbled table) | same | secondary-source |
| psychology (service letter "רפואה אישית Online+") | `{"percent":100,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":3,"deductibleAgorot":10000,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "השירות יינתן בהשתתפות עצמית של 100 ש"ח לייעוץ ועד 3 ייעוצים פסיכולוגיים בשנת ביטוח" | [Harel Online+ page](https://www.harel-group.co.il/Insurance/health/policies/Pages/services/personalized-medicine-online.aspx) | verified-official. These are online **consultations** through Harel's provider, not reimbursed therapy. |
| alternative_medicine (service letter "רפואה משלימה", ed. 10/2023) | `{"percent":100,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":12,"deductibleAgorot":5500,"requiredDocs":["referral"],"minAge":null,"maxAge":null}` | "השתתפות עצמית … 55 ₪ לכל טיפול או התייעצות במרפאת נותן השירות, ו-70 ₪ בבית" (paraphrase of the PDF); up to 12 treatments per insurance year | [P/14288.pdf](https://www.harel-group.co.il/P/14288.pdf) | secondary-source. In-network only (no claim). Brokers quote ₪50 and other counts. |
| physiotherapy | not-found for the current individual product | n/a | n/a | not-found |
| medical_devices | not-found. The older "שירותים רפואיים אמבולטוריים וטכנולוגיות מתקדמות" (ed. 04/2018: ₪11,000 annual cap, with an MRI cap of ₪3,080 in some older material) is legacy. | n/a | [2018 PDF](https://www.harel-group.co.il/Policies/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99%D7%9D%20%D7%A8%D7%A4%D7%95%D7%90%D7%99%D7%99%D7%9D%20%D7%90%D7%9E%D7%91%D7%95%D7%9C%D7%98%D7%95%D7%A8%D7%99%D7%99%D7%9D%20%D7%95%D7%98%D7%9B%D7%A0%D7%95%D7%9C%D7%95%D7%92%D7%99%D7%95%D7%AA%20%D7%9E%D7%AA%D7%A7%D7%93%D7%9E%D7%95%D7%AA%20%D7%A1%D7%A4%D7%98%D7%9E%D7%91%D7%A8%202018.pdf) | not-found |

Claim documents (Harel): *"לתביעתך יש לצרף קבלות ומסמכים רפואיים רלוונטיים"*. Consultations use a separate claim form. When the שב"ן paid first, proof of what the שב"ן paid is needed for the difference rule, so add `payer_payment_proof`.

---

## 3. Clal (כלל)

**Main current product:** "מדיכלל ייעוץ ובדיקות". The current disclosure is **"ייעוץ ובדיקות (4065)", file 20-1117-0525 (05/2025)**: [PDF](https://www.clalbit.co.il/media/h0fbxga5/20-1117-0525-yeutzim-vebdikot-giluy-naot_004_hangasha-1.pdf). Prior: 20-1117-0923 (09/2023). Product page: [מדיכלל ייעוץ ובדיקות](https://www.clalbit.co.il/healthins/consultationsandexamination/). Renewable every 2 years. Not משלים שב"ן.

| Category | Rule (agorot) | Hebrew quote | Source | Confidence |
|---|---|---|---|---|
| specialist_visit | `{"percent":80,"perSessionCapAgorot":80000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":6,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "החזר עד 800 ש"ח לייעוץ בהשתתפות עצמית של 20%"; "עד 6 התייעצויות למבוטח לשנת ביטוח" | product page; 4065 05/2025 disclosure | verified-official. Plus **2 psychiatrist consults** per year as a separate sub-limit. Excluded: family or pediatric doctors (unless they hold another specialty) and pregnancy consults. Older third-party pages say ₪1,000; that is outdated. |
| diagnostic_imaging | `{"percent":80,"perSessionCapAgorot":450000,"perSessionFixedAgorot":null,"annualCapAgorot":1350000,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "תקרה שנתית מצטברת של עד 13,500 ש"ח לבדיקות רפואיות, כאשר השתתפות עצמית עומדת על 20%" | product page | verified-official for 80% and ₪13,500. The ₪4,500 per-test cap is secondary-source (product page and financon.co.il). The ₪13,500 cap also covers pregnancy tests, and routine ultrasound is excluded. |
| second_opinion (abroad) | `{"percent":80,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | 80% of a second opinion from a specialist abroad, cumulative cap ₪5,000 **per insurance period** (paraphrase, garbled extraction) | 4065 disclosure | secondary-source. The ₪5,000 is per policy period, not per year, so `annualCapAgorot` is left null. |
| lab_tests | not stated separately (probably inside the ₪13,500 diagnostics cap) | n/a | n/a | not-found |
| psychology | psychotherapy not covered in 4065. Psychiatrist consults: 2 per year inside the consultation benefit (80% up to ₪800). | see specialist_visit | product page | secondary-source |
| child_development ("מדיכלל שירותים לילד", plan 3061) | physio and OT: `{"percent":80,"perSessionCapAgorot":12000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":10,"deductibleAgorot":0,"requiredDocs":["receipt","referral"],"minAge":null,"maxAge":null}`; speech therapy: `{"percent":80,"perSessionCapAgorot":9000,...,"annualSessions":15}`; psychologist: up to 18 sessions a year (amount not found) | "כלל מדיכלל שירותים לילד (תכנית 3061): פסיכולוג עד 18 פגישות בשנה" | [onyourside.co.il](https://www.onyourside.co.il/policy/%D7%9B%D7%9C%D7%9C/%D7%9E%D7%93%D7%99%D7%9B%D7%9C%D7%9C-%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99%D7%9D-%D7%9C%D7%99%D7%9C%D7%93); [Clal page](https://www.clalbit.co.il/healthins/mediclalchildrens/); referral requirement from [2266 (2018)](https://www.clalbit.co.il/media/10748/20-0579-0318-medikal-sherutim-le-eled_004.pdf) | secondary-source |
| alternative_medicine (service letter "רפואה משלימה") | `{"percent":null,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":20,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "כתב שירות הכולל: עד 20 טיפולים לשנה. … קיימת השתתפות עצמית." | [Clal page](https://www.clalbit.co.il/healthins/alternativemedicine/) | verified-official for the 20 treatments. The co-pay amount was **not found**. An older version had 20% of the clinic price list. In-network, paid at the clinic. |
| physiotherapy (adult), medical_devices | not-found | n/a | n/a | not-found |

---

## 4. Phoenix (הפניקס)

**Main current product:** "ייעוץ ובדיקות" (Phoenix markets it as "ייעוץ, בדיקות ואבחון מהיר"), **plan 6782**. Editions found: **01/2024**, **04/2024** and **11/2024**. The 11/2024 edition widened the coverage at no extra premium (expansion reported from 14 Nov 2024).
- [nispach6782-1124.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/HealthInsurance/nispach6782-1124.pdf), [gilui-6782-1124.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/HealthInsurance/gilui-6782-1124.pdf), [nispach-6782-0424.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/HealthInsurance/nispach-6782-0424.pdf)
- Product page: [שירותים אמבולטוריים – ייעוץ ובדיקות](https://www.fnx.co.il/health-insurance/amboltorein/amboltorein-services/)

Other terms: maximum entry age 70. Waiting period 90 days (9 months for pregnancy, 12 months for screening). Not משלים שב"ן. If the member also has the "אבחון רפואי מהיר" plan, 6782 does not refund the co-pay paid there.

| Category | Rule (agorot) | Hebrew quote | Source | Confidence |
|---|---|---|---|---|
| specialist_visit (11/2024) | `{"percent":80,"perSessionCapAgorot":80000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "20% השתתפות עצמית … 800 ₪ לייעוץ" (excerpt from the 11/2024 table); product page: refund of up to ₪800 per specialist consult *(paraphrase)* | gilui-6782-1124; product page | verified-official for 80% and ₪800. **Oncology consult cap ₪1,600; psychiatry ₪800**. Annual count unconfirmed: the excerpt "looks like 6". One report says the expansion raised the cap to ₪850, which I couldn't confirm. The **01/2024 and 04/2024 editions** said up to 75–80% and no more than ₪700, with *3* consults a year (conflicting extractions). |
| diagnostic_imaging (11/2024, MRI) | `{"percent":80,"perSessionCapAgorot":450000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt","referral"],"minAge":null,"maxAge":null}` | "20% לבדיקה … הדמיה באמצעות אולטרסאונד ₪500"; MRI ₪4,500; X-ray and CT ₪1,500; PET-CT ₪5,000 | gilui-6782-1124 | secondary-source. Caps are **per test type**, and in 01/2024 MRI/CT/PET was ₪3,500. Diagnostic tests require *"הוראת רופא מומחה בישראל בתחום הרלוונטי"*. The annual cap conflicts: the 11/2024 disclosure says ₪15,000 *"לסך כל מקרי הביטוח יחד"*, and the product page says *"תקרה שנתית של 18,600 עבור התייעצויות, בדיקות אבחנתיות וסקירה גנטית"*. So `annualCapAgorot` is left null. |
| lab_tests | `{"percent":80,"perSessionCapAgorot":null,...}` | product page lists *"בדיקות מעבדה"* among covered diagnostics | product page | secondary-source (₪500 appeared once next to lab tests; possibly a misread of the ultrasound row) |
| second_opinion | not stated separately (oncology consult up to ₪1,600) | n/a | n/a | not-found |
| psychology | 6782 covers psychiatrist consults only (up to ₪800). There is a separate psychological service in the extra-covers list, with no amounts found. | n/a | [extra-covers](https://www.fnx.co.il/health-insurance/extra-covers/) | not-found |
| child_development (plan **6789**, 01/2024; eased in 09/2024) | `{"percent":null,…,"maxAge":21}` (amounts unreadable) | covers speech therapy, OT, psychology (at the provider's clinics only) and diagnoses; entry up to 20, cover ends at 21 | [gilui-6789-0124.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/HealthInsurance/gilui-6789-0124.pdf), [HITPATCHUT.pdf (09/2024)](https://digital-content.fnx.co.il/Documents/HITPATCHUT.pdf) | not-found (amounts). The 2017 version had a ₪70 co-pay per treatment, which is outdated. |
| physiotherapy (plan **6794**, 01/2024) | `{"percent":null,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":12,"deductibleAgorot":0,"requiredDocs":["receipt","referral"],"minAge":null,"maxAge":null}` | physiotherapy and/or hydrotherapy only in a defined period after surgery, hospitalisation or diagnosis of a severe illness, with a specialist referral; up to 12 treatments per calendar year *(paraphrase)* | [nispach-6794-0124.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/healthinsurance/nispach-6794-0124.pdf) | secondary-source |
| alternative_medicine (service letter **6792**, 01/2024) | `{"percent":80,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":10,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "20% השתתפות עצמית במרפאות הסדר … 10 טיפולים" | [nispach-6792-0124.pdf](https://digital-content.fnx.co.il/sites/docs/polarchive/HealthInsurance/nispach-6792-0124.pdf), [product page](https://www.fnx.co.il/health-insurance/extra-covers/complete/) | verified-official for the in-network rule. Out-of-network up to ₪160 per treatment is broker-only (secondary). 90-day waiting period. |
| medical_devices | not-found | n/a | n/a | not-found |

Phoenix service letter (A-List / fast specialist): co-pay **₪120** per specialist meeting, **₪160** for VIP at Assuta, 30-day waiting period ([service-letter-contanct.pdf](https://digital-content.fnx.co.il/Documents/service-letter-contanct.pdf)). These are in-network, with nothing to claim.

---

## 5. Migdal (מגדל)

**Main current products** (03/2024 generation):
- "ייעוץ ובדיקות אבחנתיות (מורחב)", adult **2395** / child **2396**, ed. **03/2024**: [PDF](https://storageblobwebprod.blob.core.windows.net/mediaprod/23991/consultations-and-extended-diagnostic-tests-032024.pdf)
- "ייעוץ ובדיקות אבחנתיות – בסיס", **2378/2379**: [PDF](https://storageblobwebprod.blob.core.windows.net/mediaprod/23993/bituah_yauz_vebdikot_ivhuniot.pdf)
- Legacy "נספח ייעוץ ובדיקות אבחנתיות – אמבולטורי" 2210/2211 (ed. 01/2020 and earlier), still held by many existing customers.

None of these is משלים שב"ן.

| Category | Rule (agorot) | Hebrew quote | Source | Confidence |
|---|---|---|---|---|
| specialist_visit, out-of-network (extended 2395) | `{"percent":80,"perSessionCapAgorot":80000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":6,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | 80% of actual expense up to ₪800 per consultation, ₪1,500 for oncology, neurology or cardiology *(paraphrase of the 03/2024 PDF)* | 2395 PDF | secondary-source (6 per year is also from a garbled extraction) |
| specialist_visit, in-network (basic and extended) | `{"percent":100,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":25000,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "התייעצות עם רופא מומחה שבהסכם … השתתפות עצמית של 250 ש"ח בגין כל התייעצות" | 2378 / 2395 PDFs | secondary-source. Extractions also show **₪120** "לזמינות הרופא המבוקש" (choosing a specific network doctor). The legacy 2210 rider had a ₪150 co-pay and 4 fast-track consults a year. |
| diagnostic_imaging (basic 2378; extended similar) | `{"percent":80,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":2000000,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt","referral"],"minAge":null,"maxAge":null}` | "השתתפות עצמית של 20% מתעריף משרד הבריאות"; annual maximum for all diagnostic tests ₪20,000 | 2378 PDF; 2210 legacy disclosure | secondary-source. **The 20% is of the Ministry of Health tariff, not the actual price**, so for a private-price receipt the real refund is lower than 80%. The legacy 2210 cap was ₪12,000. |
| lab_tests | not stated separately | n/a | n/a | not-found |
| psychology (psychiatrist, extended) | in-network co-pay ₪220, up to 4 consults a year | n/a | 2395 PDF | secondary-source |
| child_development (psychodidactic assessment, extended) | `{"percent":80,"perSessionCapAgorot":100000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | 80% of the amount paid, up to ₪1,000 per assessment *(paraphrase)* | 2395 PDF | secondary-source |
| alternative_medicine, track A, in-network (service letter **2386**, 03/2024) | `{"percent":100,"perSessionCapAgorot":null,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":16,"deductibleAgorot":5500,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "מטפלים שבהסכם בעלות 55 ₪ עבור כל טיפול ו/או התייעצות במרפאה או 75 ₪ … בבית המנוי"; "עד 16 טיפולים לשנה" | [Migdal page](https://www.migdal.co.il/product/health-complementary-medicine); [refua_mashlima.pdf](https://storageblobwebprod.blob.core.windows.net/mediaprod/23994/refua_mashlima.pdf) | verified-official (co-pay is CPI-linked) |
| alternative_medicine, track B, out-of-network | `{"percent":50,"perSessionCapAgorot":12000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":16,"deductibleAgorot":0,"requiredDocs":["receipt"],"minAge":null,"maxAge":null}` | "מטפלים שאינם בהסכם בעלות של 50% מעלות הטיפול … ועד 120 ₪ לכל טיפול" | Migdal page | verified-official (the 16 is assumed to be shared with track A) |
| alternative_medicine, track C (**שב"ן-linked**) | `{"percent":50,"perSessionCapAgorot":10000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":16,"deductibleAgorot":0,"requiredDocs":["receipt","payer_payment_proof"],"minAge":null,"maxAge":null}` | "50% מסכום ההשתתפות העצמית ששולמה ע״י המנוי לקופת החולים בפועל, אך לא יותר מ-100 ₪ לכל טיפול" | Migdal page | verified-official. `isShabanSupplement: true`. The 50% applies to the **HMO co-pay**, not the full price. |
| medical_devices ("הרחבה לאמבולטורי – שיקום ואביזרים רפואיים" 2247, **ed. 09/2018**, legacy) | `{"percent":80,"perSessionCapAgorot":1000000,"perSessionFixedAgorot":null,"annualCapAgorot":null,"annualSessions":null,"deductibleAgorot":0,"requiredDocs":["receipt","referral"],"minAge":null,"maxAge":null}` | 80% up to ₪10,000 per device and ₪50,000 per illness or accident; devices costing over ₪250, on a specialist's order *(paraphrase)* | [shikum_veavizarim0918.pdf](https://storageblobwebprod.blob.core.windows.net/mediaprod/8910/shikum_veavizarim0918.pdf) | secondary-source (2018 edition; I couldn't tell whether it is still sold) |
| physiotherapy | the same 2247 extension covers rehab by a physiotherapist or OT, with no current amounts found | n/a | 2247 | not-found |

Migdal online doctor: ₪75 per online session, up to 12 a year ([online counseling page](https://www.migdal.co.il/product/online-medical-counseling-service)). This is a service, with nothing to claim.

---

## 6. Group (קולקטיב) policies

Group policies are **separate contracts per employer or organisation**, with their own tables. Examples found:
- Harel: Tel Aviv Medical Center staff ([PDF](https://www.harel-group.co.il/collectives/tasmc/policies/DocLib/%D7%94%D7%9E%D7%A8%D7%9B%D7%96%20%D7%94%D7%A8%D7%A4%D7%95%D7%90%D7%99%20%D7%90%D7%99%D7%9B%D7%99%D7%9C%D7%95%D7%91%20%D7%AA%D7%9C%20%D7%90%D7%91%D7%99%D7%91%20-%20%D7%A4%D7%95%D7%9C%D7%99%D7%A1%D7%AA%20%D7%91%D7%A8%D7%99%D7%90%D7%95%D7%AA.pdf)), with a garbled reading of psychology at 20% co-pay and a ₪180 cap. Also Rafael and the Teachers' Union.
- Migdal: Discount Bank (01.09.23), IDF civilian employees, Teva, Pelephone.
- Phoenix: Amdocs, Tzevet.

They usually have a richer category list (physio, psychology, devices) with % and per-session caps, and some use a fixed ₪ deductible per claim. **No group policy is representative**, so the catalog should not ship a generic "group" preset as if it were real terms. The current `migdal_group` seed is a placeholder.

---

## 7. How much do these vary? Is one catalog value per insurer meaningful?

**No.** Evidence from just these four insurers:

1. **Several live products per insurer.** Harel has basic 527 and extended 517 with different consultation models (network-only vs free choice). Migdal has basic 2378 and extended 2395 plus legacy 2210/2211. Each also has separate riders and service letters for child development, alternative medicine and physio.
2. **Editions change numbers within months, and old editions stay in force for existing customers:**
   - Phoenix 6782: ₪700 per consult (01/2024 and 04/2024) became ₪800 (11/2024). MRI cap went from ₪3,500 to ₪4,500. The consultation count was 3 in one extraction and 6 in another.
   - Harel: the ambulatory annual cap was ₪11,000 (04/2018) and is ₪20,000–25,000 (09/2024), with a new plan numbering (520 became 527).
   - Migdal: diagnostics cap ₪12,000 (2210, 2016–2020) vs ₪20,000 (2378). Out-of-network consults went from a "₪150 co-pay, max ₪750" model to "80% up to ₪800/₪1,500".
   - Clal: brokers still quote ₪1,000 per consult, while the current page says ₪800.
3. **The same nominal "80%" means different things.** It can be 80% of the actual price (Clal, Phoenix, Harel), 80% of the **Ministry of Health tariff** (Migdal diagnostics), or 50% of the **HMO co-pay** (Migdal alt-med track C).
4. **Caps are shared, per test type, or per policy period**, not per category per year (§1.4).
5. **In-network vs reimbursement tracks** sit side by side (§1.3).
6. **Group policies are bespoke** (§6).

**Recommendation for NextInLine:**
- Treat catalog entries as **templates keyed by insurer + plan code + edition** (for example `harel:527:2024-09`, `phoenix:6782:2024-11`, `clal:4065:2025-05`, `migdal:2395:2024-03`), never as "Harel ambulatory".
- Onboarding should ask for the **plan code / edition** from the user's דף פרטי ביטוח or the policy PDF. Pre-fill from the template, then make the user confirm or edit each value. Extracting the values from the user's uploaded policy PDF with the existing extraction pipeline is the most reliable route.
- Extend the rule model with:
  - `track` (network | reimbursement)
  - `priceBasis` (actual | moh_tariff | other_payer_copay)
  - `sharedCapGroup` (category groups that draw from one cap)
  - per-subtype caps (MRI / CT / US)
  - `capPeriod` (year | policy_period | per_event)
  - sub-limits (psychiatrist)
  - waiting periods
  - `coordination` (§1.2)
- The current seed `privateAmbulatory` (80%/₪500/3 consults; imaging 100% up to ₪3,080; and so on) does **not** match any current product found here. ₪3,080 looks like an old Harel MRI cap. It should be replaced with versioned templates, or clearly labelled as demo data.
- Regulatory context: from 2025, the national child-development reform is phasing out HMO reimbursement for private speech, OT, physio and nutrition treatment for new patients. That changes what a "שב"ן first" leg can return for `child_development`.
