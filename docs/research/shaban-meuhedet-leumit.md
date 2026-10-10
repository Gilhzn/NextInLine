# שב"ן reimbursement terms: Meuhedet Adif / Si, Leumit Kesef / Zahav

Research date: 2026-10-10. Scope: **reimbursement (החזר כספי / שיפוי) for privately paid services only**. In-network discounted prices count as "network only, no reimbursement".

## Read this first: how this was researched, and how far to trust it

- **I could not open any source page directly.** The sandbox's outbound proxy refused connections to meuhedet.co.il, leumit.co.il, gov.il, call.gov.il and kolzchut.org.il (CONNECT 403), and WebFetch had no DNS. All findings below come from **web-search result extracts** of those pages and PDFs, restricted to the official domains. The search engine's text extraction from the PDFs was sometimes garbled. Where that happened, I say so.
- Because I never read a full official page, **no item is marked `verified-official`**. Values taken from official-domain extracts (meuhedet.co.il, leumit.co.il, call.gov.il, the Ministry of Health's "כל הבריאות" site) are marked `secondary-source`, and their source URL shows the domain. Before production use, someone with normal web access should open the two current rulebooks and check every number:
  - Meuhedet Adif rulebook (תקנון), July 2026 / תמוז תשפ"ו: https://www.meuhedet.co.il/media/8363/%D7%A2%D7%93%D7%99%D7%A3-%D7%99%D7%95%D7%9C%D7%99-2026.pdf
  - Leumit Kesef/Zahav agreement (filename `...-91125.pdf`, which I read as 9.11.2025): https://www.leumit.co.il/media/lbahr5ri/%D7%97%D7%95%D7%91%D7%A8%D7%AA-%D7%9C%D7%90%D7%95%D7%9E%D7%99%D7%AA-%D7%96%D7%94%D7%91-%D7%95%D7%9B%D7%A1%D7%A3-91125.pdf
  - I did not find a current Meuhedet Si rulebook PDF. The Si rates page says rates are effective 1.7.2026 and links to it: https://www.meuhedet.co.il/%D7%91%D7%99%D7%98%D7%95%D7%97%D7%99%D7%9D/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%A9%D7%99%D7%90/%D7%AA%D7%A2%D7%A8%D7%99%D7%A4%D7%99%D7%9D-%D7%95%D7%AA%D7%A7%D7%A0%D7%95%D7%9F/
- I invented no numbers. Each number is quoted from an extract. A field that is an inference rather than a quote is labelled **ASSUMPTION**.

## How the plans are structured (this affects the routing engine)

- **Meuhedet Si sits on top of Adif.** The Si rates page lists the premium as the Adif base plus a Si supplement plus a total. A Si member is therefore also an Adif member, and the Si rules below are *additional* to Adif. Example: Adif gives 3 second opinions a year and Si adds 1, for 4 in total. Model a Si member as enrolled in both `meuhedet_adif` and `meuhedet_shia`.
- **Leumit Kesef and Zahav are parallel, not layered.** The Ministry of Health's shaban report says: "בלאומית תוכניות השב"ן מקבילות ואינן מדורגות כרבדים". A member holds one or the other.

## Rule JSON conventions

Rules follow `benefitRuleSchema` in `packages/shared/src/rules.ts`. Amounts are in agorot (₪ × 100). `rule: null` means either no reimbursement exists (network only) or nothing was found.

---

## 1. מאוחדת עדיף (`meuhedet_adif`)

### specialist_visit and second_opinion (Meuhedet runs one benefit, "חוות דעת נוספת")
```json
{ "percent": 85, "perSessionCapAgorot": 79200, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 3, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": null }
```
- Quote from the 2026 rulebook: "שיפוי בשיעור של 85% מההוצאה לרכישת חוות הדעת הנוספת בלבד, שהשיפוי לא יעלה על 792 ש"ח". Quote from the Adif page: "3 חוות דעת של רופאים מומחים במהלך שנה קלנדרית".
- Sources: the Adif rulebook, July 2026 (תמוז תשפ"ו), https://www.meuhedet.co.il/media/8363/%D7%A2%D7%93%D7%99%D7%A3-%D7%99%D7%95%D7%9C%D7%99-2026.pdf, and the Adif second-opinion page, https://www.meuhedet.co.il/%D7%91%D7%99%D7%98%D7%95%D7%97%D7%99%D7%9D/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%A2%D7%93%D7%99%D7%A3/%D7%97%D7%95%D7%95%D7%AA-%D7%93%D7%A2%D7%AA-%D7%A0%D7%95%D7%A1%D7%A4%D7%AA/
- Confidence: `secondary-source`. The search tool flagged the PDF extraction as garbled at the cap figure. An older Adif page for discharged soldiers states "85% ... 752 ₪", and the Ministry of Health's call.gov.il page says "about 700 ₪". 792 is the July 2026 figure; confirm it in the PDF.
- Conditions:
  - Waiting period: 6 months.
  - The doctor must be on Meuhedet's list of consulting physicians recognised for refunds. Doctors who serve Meuhedet under the national health basket are excluded from that list.
  - The invoice must name the doctor and show their licence number.
  - Online consultations are not refunded.
  - There is also an in-network track with a fixed price of 200–300 ₪. That track pays no refund.
  - Exclusions found on call.gov.il: dental consultations, complementary-medicine consultations, and opinions for legal purposes.

### physiotherapy
`rule: null`, `not-found`. No shaban reimbursement rule for Adif was found. Physiotherapy is provided through Meuhedet's institutes and contracted institutes for a quarterly fee. A refund for a private physiotherapist is handled only with prior approval from a district physiotherapist: "בקשת ההחזר תטופל אם קיבלת אישור מראש של פיזיותרפיסט/ית מחוזי/ת". That appears to be the health-basket route, not the Adif plan. Source: the online refunds page, https://www.meuhedet.co.il/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%90%D7%95%D7%A0%D7%9C%D7%99%D7%99%D7%9F-%D7%90%D7%AA%D7%A8-%D7%95%D7%90%D7%A4%D7%9C%D7%99%D7%A7%D7%A6%D7%99%D7%94/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%90%D7%95%D7%A0%D7%9C%D7%99%D7%99%D7%9F/%D7%91%D7%A7%D7%A9%D7%94-%D7%94%D7%97%D7%96%D7%A8%D7%99%D7%9D-%D7%91%D7%90%D7%95%D7%A0%D7%9C%D7%99%D7%99%D7%9F/

### psychology
`rule: null`, `not-found`. No Adif refund for private psychotherapy was found. The extracts show only health-basket co-payments with independent therapists (70.50 ₪ for the first session, 170 ₪ for later sessions) and Meuhedet's free online psychology service (up to 15 sessions).

### child_development
`rule: null`. Treat it as **network/co-pay**: no reimbursement rule was found. call.gov.il, updated 04/12/2025, says: "יהיה זכאי לתוספת של עד 15 טיפולים בשנה (בכל תחומי הטיפול גם יחד) בהשתתפות עצמית של 36.50 ש"ח לטיפול" for ages 3–9, once the statutory quota is used up. Source: https://call.gov.il/infocenter/index?page=content&id=EL7317. Confidence: `secondary-source`. The figures describe a co-payment, not a refund.

The basket-level private-provider refund ("גובה ההחזר נקבע לפי הסכום שקבע משרד הבריאות, בניכוי אגרת טיפול", with prior approval from a child-development institute) belongs to the health basket, not to Adif.

### diagnostic_imaging
`rule: null`, `not-found`.

### lab_tests
`rule: null`, `not-found`.

### alternative_medicine
`rule: null`. **Network only, no reimbursement.** Quote: "22 טיפולים בשנה בהשתתפות עצמית מופחתת לבעלי מאוחדת שיא ועדיף", given at Meuhedet clinics or contracted private clinics. "ניתן לממש זכאות ברובד ביטוחי אחד בלבד". Sources: the alternative-medicine price list, April 2026, https://www.meuhedet.co.il/media/8773/%D7%9E%D7%97%D7%99%D7%A8%D7%95%D7%9F-%D7%98%D7%99%D7%A4%D7%95%D7%9C%D7%99%D7%9D-%D7%9E%D7%A9%D7%9C%D7%99%D7%9E%D7%94-2026.pdf, and the older price list, https://www.meuhedet.co.il/media/7140/%D7%9E%D7%97%D7%99%D7%A8%D7%95%D7%9F-%D7%9E%D7%AA%D7%95%D7%A7%D7%9F-%D7%9C%D7%9E%D7%A8%D7%A4%D7%90%D7%95%D7%AA.pdf. Confidence: `secondary-source`. No refund route was found.

### glasses_lenses
`rule: null`, `not-found` for Adif. The optics benefit found belongs to Si (see the Si section) and is network only.

### dental
`rule: null`. **Network only, no reimbursement.** There is a price list for Meuhedet's own clinics, effective 01.02.2026, with "חבר / עדיף / שיא" price columns. Source: https://meuhedet.co.il/media/8691/%D7%9E%D7%97%D7%99%D7%A8%D7%95%D7%9F-%D7%A9%D7%99%D7%A0%D7%99%D7%99%D7%9D-2026.pdf. Confidence: `secondary-source`.

### medical_devices
`rule: null`. Found, but it does not fit the format.
- The 2026 rulebook extract says "750 דולר הסכום המרבי להחזר למבוטח בגין רכישת מכשירים/אביזרים רפואיים". The cap is in USD, and the extract did not make clear whether this covers devices bought abroad or general devices, or which device list applies.
- Hearing-assist accessories (TV sound systems, FM and similar) are sold through Meuhedet at a co-payment, one per category every 2 years. Example: TV sound system 498 ₪ (Adif) vs 148 ₪ (Si). Quote: "אין החזר כספי לרכישה פרטית". Waiting period: 3 months.
- Source: the hearing-accessories page, https://www.meuhedet.co.il/%D7%9E%D7%99%D7%93%D7%A2-%D7%9C%D7%9C%D7%A7%D7%95%D7%97/%D7%90%D7%91%D7%99%D7%96%D7%A8%D7%99%D7%9D-%D7%9E%D7%9B%D7%A9%D7%99%D7%A8%D7%99%D7%9D-%D7%95%D7%A9%D7%99%D7%A8%D7%95%D7%AA%D7%99%D7%9D-%D7%9C%D7%9E%D7%91%D7%95%D7%98%D7%97%D7%99%D7%9D/%D7%A8%D7%9B%D7%99%D7%A9%D7%AA-%D7%90%D7%91%D7%99%D7%96%D7%A8%D7%99%D7%9D-%D7%95%D7%9E%D7%9B%D7%A9%D7%99%D7%A8%D7%99-%D7%A9%D7%9E%D7%99%D7%A2%D7%94/ and the 2026 rulebook.
- Confidence: `secondary-source`. Needs a manual reading of the rulebook (appendix ו׳ and part ב׳, section 14).

---

## 2. מאוחדת שיא (`meuhedet_shia`): additional layer on top of Adif

### specialist_visit and second_opinion
```json
{ "percent": 85, "perSessionCapAgorot": null, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 1, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": null }
```
- Quote from the Si page: "אתם זכאים לארבע חוות דעת בשנה קלנדרית (ינואר-דצמבר), אחרי שצברתם וותק של שישה חודשים בתכנית ... על תשלום זה תקבלו החזר של 85% (עד לתקרה המוגדרת בתקנון)". Discharged-soldiers page: "סה"כ 4 התייעצויות (במסגרת עדיף + שיא) בשנה קלנדרית".
- Source: the Si second-opinion page, https://www.meuhedet.co.il/%D7%91%D7%99%D7%98%D7%95%D7%97%D7%99%D7%9D/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%A9%D7%99%D7%90/%D7%97%D7%95%D7%95%D7%AA-%D7%93%D7%A2%D7%AA-%D7%A0%D7%95%D7%A1%D7%A4%D7%AA/. The page is undated; the search index marked it as old.
- Confidence: `secondary-source`.
- `annualSessions: 1` means Si's own extra session: 4 in total minus Adif's 3. The cap is **not found**: the Si rulebook was not available, and the site says Si gets "improved refunds". Waiting period: 6 months.

### physiotherapy
`rule: null`, `not-found`.

### psychology
`rule: null`. **Network/co-pay, no reimbursement found.** Si children get "40 טיפולים רגשיים בשנה לילדים עד גיל 12 ... 24 טיפולים רגשיים בשנה לבני נוער 12-18", at a co-payment of 45 ₪ per treatment. Source: the "השיא שלנו" page, https://www.meuhedet.co.il/%D7%91%D7%99%D7%98%D7%95%D7%97%D7%99%D7%9D/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%A9%D7%99%D7%90/%D7%94%D7%A9%D7%99%D7%90-%D7%A9%D7%9C%D7%A0%D7%95/. Confidence: `secondary-source`. No adult benefit was found.

### child_development
`rule: null`. **Network/co-pay, no reimbursement found.** call.gov.il (updated 04/12/2025) says: "זכאי לקבל עד 25 טיפולים בשנה מעבר לזכאות מתוקף מאוחדת "עדיף" ובכפוף לתשלום השתתפות עצמית בגובה 45 ש״ח לטיפול". The search tool said the extract was jumbled. An older Meuhedet page says "תוספת של עד 15 טיפולים ... 35 ₪". Source: https://call.gov.il/infocenter/index?page=content&id=EL7317. Confidence: `secondary-source`.

### diagnostic_imaging
`rule: null`, `not-found`.

### lab_tests
`rule: null`, `not-found`.

### alternative_medicine
`rule: null`. **Network only, no reimbursement.** This is the same 22-treatments-a-year co-payment benefit as Adif. Quote: "בתום המימוש לא ניתן לנצל זכאות עדיף". Waiting period: 12 months. Same sources as Adif. Confidence: `secondary-source`.

### glasses_lenses
`rule: null`. **Network only, no reimbursement.**
- Quote: "מבוטחים מגיל 18 ועד גיל 70 בתוכנית "מאוחדת שיא" זכאים מדי שנתיים לרכוש משקפיים אופטיים או עדשות מגע אופטיות במבחר חנויות שבהסדר עם מאוחדת, ולא יינתן החזר בגין רכישה זהה בסניף שאינו קשור בהסכם עם "מאוחדת אופטיקה"".
- The network discount: 80% up to 900 ₪, 50% between 900 and 2,300 ₪, and a fixed 1,150 ₪ above 2,300 ₪. Children's glasses carry a co-payment of up to 70 ₪.
- Contact lenses are refunded only for anterior-chamber eye disease, with an ophthalmologist's recommendation.
- Source: the Meuhedet Optics page, https://www.meuhedet.co.il/%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%90%D7%95%D7%A4%D7%98%D7%99%D7%A7%D7%94/%D7%90%D7%95%D7%93%D7%95%D7%AA-%D7%9E%D7%90%D7%95%D7%97%D7%93%D7%AA-%D7%90%D7%95%D7%A4%D7%98%D7%99%D7%A7%D7%94/
- Confidence: `secondary-source`.

### dental
`rule: null`. **Network only, no reimbursement.** In Meuhedet clinics, Si prices are: conservative treatments 34 ₪; restorative, surgical and periodontal treatment at 50% of the member price; orthodontics at 60% off. Price list effective 01.02.2026, linked above. A Si member who has not finished the waiting period pays the Adif price list. Confidence: `secondary-source`.

### medical_devices
`rule: null`. Hearing-assist accessories at a lower Si co-payment (for example, TV system 148 ₪). Network only; "אין החזר כספי לרכישה פרטית". Confidence: `secondary-source`.

---

## 3. לאומית כסף (`leumit_kesef`)

### specialist_visit and second_opinion (Leumit runs one benefit, "התייעצות / חוות דעת שניה")
```json
{ "percent": 80, "perSessionCapAgorot": 69000, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 1, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": null }
```
- Quote from the agreement (section 3.1.2/3.2.1): "הקופה תשפה את העמית בסכום בשיעור של 80% מההוצאות הממשיות ... עד תקרה בגובה 690 ש"ח להתייעצות". Quote from the consultations page: "למבוגרים (מעל גיל 18) התייעצות אחת בשנה. לילדים (עד גיל 18) 2 התייעצויות בשנה. תקופת המתנה לשירות – 6 חודשים".
- Sources: the agreement PDF (9.11.2025), https://www.leumit.co.il/media/lbahr5ri/%D7%97%D7%95%D7%91%D7%A8%D7%AA-%D7%9C%D7%90%D7%95%D7%9E%D7%99%D7%AA-%D7%96%D7%94%D7%91-%D7%95%D7%9B%D7%A1%D7%A3-91125.pdf, and the consultations page, https://www.leumit.co.il/insurance-policies/leumit-silver-and-gold/consultations/
- Confidence: `secondary-source`.
- **The cap is uncertain.** The search tool tied 690 ₪ to Kesef from the order of the PDF text. An older version of the Ministry of Health's call.gov.il page shows Kesef at 611 ₪ and Zahav at 672 ₪. The PDF also contains an "816 ש"ח" figure that could not be assigned to a plan.
- Children (under 18) get 2 sessions a year: model that as `annualSessions` 2 with `maxAge` 17.
- The doctor's name must be on Leumit's "יועצים מוכרים להחזר" list on the day of the consultation.
- Quote: "לא יינתן החזר על ייעוץ הניתן במסגרת מרפאת חוץ של בית חולים".
- There is an in-network track with a 200 ₪ co-payment, which pays no refund.

### physiotherapy
`rule: null`, `not-found` for reimbursement. The agreement extract shows about 12 extra physiotherapy treatments a year after the basket entitlement is used up, given through the network against a commitment (Form 17), at a co-payment of 38 ₪ per treatment. The extract was garbled. A row for "פיזיותרפיסט / מרפא בעיסוק / קלינאי תקשורת / פסיכולוג" with reimbursement caps exists in the agreement, but its numbers were unreadable. Source: the agreement PDF and https://www.leumit.co.il/physiotherapy/

### psychology
`rule: null`, `not-found` for adults. For children, psychological treatment is part of the child_development quota below.

### child_development
```json
{ "percent": 100, "perSessionCapAgorot": 11400, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 30, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": 17 }
```
- Quote: "עמית ״לאומית כסף״ יהיה זכאי לסך כולל של 30 טיפולים בשנה ... השיפוי לעמיתי "לאומית כסף" הינו עד תקרה בגובה 114 ש"ח לטיפול".
- Source: call.gov.il "סל השירותים בתחום התפתחות הילד", updated 04/12/2025, https://call.gov.il/infocenter/index?page=content&id=EL7317. The same figures appear in the Leumit agreement extract (30 for Kesef vs 55 for Zahav).
- Confidence: `secondary-source`.
- **ASSUMPTION: `percent: 100`.** The source says only "reimbursement up to a 114 ₪ cap per treatment".
- The 38 ₪ co-payment applies at network providers. Whether it is also deducted from refunds is unknown.
- The age limit is "עד גיל 18", so `maxAge` 17 is used. Confirm whether the limit is inclusive.
- The quota covers physiotherapy, occupational therapy, speech therapy and psychological treatment combined.
- Waiting period: not found.

### diagnostic_imaging
`rule: null`, `not-found`. The agreement mentions refunds for "בדיקות רפואיות" from non-network providers up to a cap, but the table was unreadable.

### lab_tests
`rule: null`, `not-found`.

### alternative_medicine
`rule: null`. **Network only, no reimbursement.** Quote: "אין הגבלה על מספר הטיפולים ברפואה המשולבת. אין חובה בהפנייה לטיפולים. אין תקופת המתנה", at Leumit's discounted prices. Source: https://www.leumit.co.il/heb/Rights/NaturalMedicine/. Confidence: `secondary-source`. No refund route was found.

### glasses_lenses
`rule: null`. **Network only, no reimbursement.** The benefit runs through Leumit Optics, and the details found are Gold-specific (see Zahav). Source: https://www.leumit.co.il/optics/. Confidence: `secondary-source`.

### dental
`rule: null`. Treated as network; see the Zahav dental entry for the details. Nothing Kesef-specific was found. Confidence: `not-found`.

### medical_devices
`rule: null`, `not-found`. The agreement says refunds exist for "אביזרים רפואיים" under its terms, with "לא ינתן החזר בגין אביזר שנרכש בבית מרקחת של הקופה". No cap was readable. Quote: "החל מיום 01.05.2025 מימון מכשירי שמיעה יעשה דרך הסל בלבד", meaning the shaban hearing-aid subsidy ended on 1.5.2025. Source: https://www.leumit.co.il/family-health/buying-hearing-aids/

---

## 4. לאומית זהב (`leumit_zahav`)

### specialist_visit and second_opinion
```json
{ "percent": 80, "perSessionCapAgorot": 69000, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 3, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": null }
```
- Quote from the agreement: "השיפוי לעמיתי "לאומית זהב" הינו עד תקרה בגובה 690 ש"ח להתייעצות" and "80% מההוצאות הממשיות". Quote from the consultations page: "למבוגרים (מעל גיל 18) 3 התייעצויות בשנה. לילדים (מתחת לגיל 18) 4 התייעצויות בשנה". The waiting period is "3 חודשים".
- Sources: the agreement PDF (9.11.2025) and the consultations page, both linked above.
- Confidence: `secondary-source`.
- Other cap figures exist: the older call.gov.il page says 672 ₪, and an older Leumit page says 668 ₪ for a consultation or 1,336 ₪ for an opinion. 690 ₪ is the figure from the 2025 agreement.
- Children get 4 sessions a year. The same conditions on the recognised-doctor list and the hospital-outpatient exclusion apply as for Kesef.

### physiotherapy
`rule: null`, `not-found` for reimbursement. The network benefit is about 12 extra treatments a year at 38 ₪ per treatment; that extract was garbled. call.gov.il gives Zahav co-payments of 36 ₪ for group and 54 ₪ for individual treatment. A reimbursement row exists in the agreement (one extract read about 799 ₪, flagged as unreliable). It is not encoded here.

### psychology
`rule: null`, `not-found` for adults. Children are covered under child_development.

### child_development
```json
{ "percent": 100, "perSessionCapAgorot": 15200, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 55, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": 17 }
```
- Quote: "עמית "לאומית זהב" יהיה זכאי לסך כולל של 55 טיפולים בשנה ... השיפוי לעמיתי "לאומית זהב" הינו עד תקרה בגובה 152 ש"ח לטיפול".
- Source: call.gov.il EL7317, updated 04/12/2025. Confirmed by the Leumit agreement extract ("55 טיפולים בשנה בתחום התפתחות הילד, לילדים עד גיל 18").
- Confidence: `secondary-source`.
- **ASSUMPTION: `percent: 100`**, for the same reason as Kesef.
- Network co-payment: 23 ₪ per treatment.
- The quota covers physiotherapy, occupational therapy, speech therapy and psychological treatment combined.

### diagnostic_imaging
`rule: null`, `not-found`.

### lab_tests
`rule: null`, `not-found`.

### alternative_medicine
`rule: null`. **Network only, no reimbursement.** Quote: "לקוחות לאומית זהב זכאים לטיפולי רפואה משלימה במחיר משתלם, ללא הגבלה על מספר הטיפולים". Source: https://www.leumit.co.il/alternative-medicine/everything-you-wanted-to-know-about-acupuncture/. Confidence: `secondary-source`.

### glasses_lenses
`rule: null`. **Network only, no reimbursement.**
- Members over 18 get up to 70% off at Leumit Optics. One offer: glasses including frame, lenses and eye exam for 150 ₪.
- Members under 18 get one pair a year at a 21 ₪ co-payment.
- The "full refund" wording on these pages is a satisfaction guarantee (return within 3–5 months), not reimbursement.
- Source: https://www.leumit.co.il/optics/. Confidence: `secondary-source`.

### dental
`rule: null`. Mostly network, with a partial reimbursement route that does not fit the format.
- Treatment is at about 300 contracted private clinics, at Zahav prices.
- The 2023 brochure says a non-network dentist is reimbursed "לפי מחירון מרפאות שיניים שבהסדר, בכפוף לאישור מראש ולהצגת חשבונית מפורטת". That is a per-procedure tariff, not a percentage.
- Source: the August 2023 brochure, https://www.leumit.co.il/media/hybhfvo4/32163_85767_leumit_dental_care_brochure_v2_a5-1.pdf
- Confidence: `secondary-source`. The brochure is from 2023.

### medical_devices
`rule: null`, `not-found`. Same as Kesef, including the end of the shaban hearing-aid subsidy on 1.5.2025.

---

## Gaps worth closing manually, in priority order

1. Meuhedet Si rulebook: the Si second-opinion cap, and any Si reimbursement for psychology or physiotherapy.
2. The Leumit agreement's non-network reimbursement table: the row for physio, occupational therapy, speech therapy and psychologist; the row for tests; and the row for devices. The numbers exist but the extraction was unreadable.
3. The Leumit Kesef consultation cap (690 vs 611 ₪).
4. The Meuhedet Adif cap of 792 ₪ (extraction flagged as garbled), and the $750 devices clause.
5. Whether Leumit's child-development "שיפוי עד תקרה" means 100% of cost up to the cap, or cost minus the co-payment.
