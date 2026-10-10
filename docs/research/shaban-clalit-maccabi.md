# שב"ן reimbursement terms: Clalit Mushlam (Zahav / Platinum), Maccabi Zahav / Sheli

Research date: 2026-10-10. Scope: **refunds (החזר כספי) for services paid privately**. Discounted in-network prices (השתתפות עצמית בספקי הסדר) are marked "network only, no reimbursement".

## Method and limitations (read first)

- In this environment, direct HTTP fetches (WebFetch and curl) to `clalit.co.il`, `mushlam.clalit.co.il`, `maccabi4u.co.il`, `gov.il` and `kolzchut.org.il` were **blocked by the egress proxy or failed DNS**. So all data below comes from web-search result extracts of those pages. Quotes are the Hebrew text the search index returned from the official page. Before production use, confirm each number against the live page or the PDF.
- Official תקנון PDFs found (titles confirm the versions; the full text could not be downloaded):
  - Maccabi Zahav תקנון, **August 2026**: https://www.maccabi4u.co.il/media/lxtetxif/maccabi_zahav_regulations.pdf
  - Maccabi Sheli תקנון, **August 2026**: https://www.maccabi4u.co.il/media/no1nug5m/maccabi_sheli_regulations.pdf
  - Clalit: the Mushlam home page links "תקנון זהב / תקנון פלטינום / תקנון מושלם זהב ופלטינום" (https://mushlam.clalit.co.il/he/Pages/default.aspx). The PDF URL and version could not be retrieved.
- The Ministry of Health שב"ן comparison on gov.il and the Kol-Zchut pages could not be reached, so there is no cross-check from them.
- **Plan naming:** Clalit's base tier is now called **"כללית מושלם זהב"**, which was formerly just "כללית מושלם". **"מושלם פלטינום"** is an add-on on top of Zahav: "לקוחות מושלם פלטינום זכאים לכל השירותים של מושלם זהב". The same applies at Maccabi: **מכבי שלי** members get all **מכבי זהב** rights plus Sheli add-ons. Platinum and Sheli therefore inherit every base-tier rule below unless noted.
- Amounts are CPI-indexed (צמוד למדד) and change during the year. Official pages often disagree with each other on the exact cap. Conflicts are listed for each item.
- Amounts are in agorot (₪ × 100).

---

## 1. clalit_mushlam (כללית מושלם זהב)

### specialist_visit: התייעצות עם רופא מומחה, מסלול החזר
```json
{ "percent": 80, "perSessionCapAgorot": 71500, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 3, "deductibleAgorot": 0, "requiredDocs": ["receipt"], "minAge": null, "maxAge": null }
```
- Quote: "החזר המושלם הוא 80% מההוצאה בפועל, ולא יותר מ- 715 ש"ח לייעוץ. (צמוד למדד)"; "הזכאות הכוללת היא לשלוש התייעצויות בשנה קלנדרית (ינואר- דצמבר) בשני מסלולי ההתייעצות- החזר והסדר, במצטבר"
- Sources: https://www.clalit.co.il/he/myrights/medical-tests/Pages/medical-specialist.aspx ; https://mushlam.clalit.co.il/he/consultation/Pages/second_opinion_refund.aspx
- Source version: undated web pages; the cap is CPI-indexed.
- Waiting period: **6 months** ("האם צריך תקופת אכשרה? כן, 6 חודשים").
- Conditions:
  - The doctor must appear on the list of specialists Mushlam recognizes as consultants.
  - The 3 per year are shared between the refund and network tracks.
  - Does not cover tests. A psychologist does not qualify, and neither does a medico-legal opinion.
  - No refund for a doctor seen in a Clalit or public clinic in the previous 6 months.
  - Documents: original tax invoice and receipt, signed, with the patient's details and the visit date.
- Conflict: mushlam.clalit.co.il gives "עד לתקרת החזר של כ-677 ש"ח", and older pages give "כ-600 ₪". The 715 figure is the newest/highest found.
- Confidence: **verified-official** (official page; cap differs between official pages).
- Related: the Zahav compare page mentions an extra consultation for ages 60+ (refund figure 609 or 679 ₪ on different pages). Not verified; not included.

### second_opinion
Same benefit and rule as specialist_visit. Clalit titles it "חוות דעת שנייה: התייעצות עם רופא מומחה במושלם". Same sources and confidence.

### physiotherapy: פיזיותרפיה, מסלול החזר
```json
{ "percent": 75, "perSessionCapAgorot": 11100, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 24, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": 18, "maxAge": null }
```
- Quote: "החזר המושלם הוא 75% מההוצאה בפועל, ולא יותר מ- 111 ש"ח לטיפול."; "לקוחות כללית מושלם מעל גיל 18 זכאים לעד 24 טיפולים בשנה הניתנים על ידי פיזיותרפיסט מומחה."
- Source: https://www.clalit.co.il/he/myrights/physiotherapy/Pages/physiotherapy-general.aspx (also https://mushlam.clalit.co.il/he/HEALING/Pages/physical_therapy.aspx)
- Waiting period: **6 months**.
- Conditions: a referral from any Clalit doctor that describes the problem and is relevant to the current treatment year. You pay the provider the full price, then claim.
- Conflict: the Zahav newsletter says "75% ועד כ-100 ₪ לטיפול" (older).
- Confidence: **verified-official**.

### psychology
- **Adults:** no Mushlam refund found. Adult psychotherapy is a basic-basket service with independent therapists under arrangement (network). → **network only, no reimbursement** (Mushlam Zahav, adults).
- **Children 3–18:** covered inside the child-development pool, with the same refund as child_development (75%, up to 125 ₪ per treatment). Quote from the 10–18 page: "פסיכולוג... החזר המושלם הוא 75% מההוצאה בפועל ולא יותר מ-125 ₪ לטיפול". Source: https://mushlam.clalit.co.il/he/development/Pages/child_development10-17.aspx
```json
{ "percent": 75, "perSessionCapAgorot": 12500, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": null, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": 3, "maxAge": 17 }
```
- annualSessions is null because sessions count against the child-development pool (see below). maxAge 17 reflects "עד גיל 18".
- Confidence: **verified-official** for children (the cap conflicts with "כ-100 ₪" on the newsletter). **not-found** for an adult refund.

### child_development: ריפוי בעיסוק, קלינאות תקשורת, פיזיותרפיה (and psychologist / social worker), מסלול החזר
```json
{ "percent": 75, "perSessionCapAgorot": 12500, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 45, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": 3, "maxAge": 9 }
```
```json
{ "percent": 75, "perSessionCapAgorot": 12500, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 30, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": 10, "maxAge": 17 }
```
- Quote: "החזר המושלם הוא 75% מההוצאה בפועל ולא יותר מ-125 ₪ לטיפול (צמוד למדד)"; ages 3–9: "עד 45 טיפולים בשנה קלנדרית" (Zahav); ages 10–18: "עד 30 טיפולים בשנה" (Zahav).
- Sources:
  - https://mushlam.clalit.co.il/he/development/Pages/child_development10-17.aspx
  - https://mushlam.clalit.co.il/he/development/Pages/development_3-10_years.aspx
  - https://www.clalit.co.il/he/myrights/child-development/Pages/default.aspx
- Conditions:
  - Up to age 8 inclusive, the child must first use up the basic-basket entitlement ("למצות את הזכאות בסל").
  - A diagnosis by a specialist (developmental) physician is required.
- Conflicts:
  - The 3–10 page also states "סך הכל 30 טיפולים בשנה קלנדרית ולא יותר מ-100 טיפולים בכל תקופות החברות". This may describe the co-pay (network) track or older terms.
  - The newsletter gives a cap of "כ-100 ₪ לטיפול".
- **Regulatory caveat:** the MoH child-development reform (from 1.2.2026, staged through 2030) phases out **basic-basket** refunds for private treatment for new patients. No source said whether the Mushlam שב"ן refund track is affected. Confirm with Clalit (*2700) before relying on it for new patients.
- Confidence: **verified-official** (session counts and cap conflict between official pages).

### Other Clalit refund item (not a target category)
Speech therapy (ריפוי בדיבור) from age 9 and for adults: "החזר עבור עד 10 טיפולים לשיקום הדיבור בשנה קלנדרית: החזר המושלם הוא 75% מההוצאה בפועל, ולא יותר מ-120 ש"ח לטיפול". Requires approval from an authorized Clalit professional. Source: https://www.clalit.co.il/he/myrights/hearing-and-speaking/Pages/speech-therapy.aspx

### diagnostic_imaging
**not-found.** MRI and CT are basic-basket services via טופס 17 at Clalit or contracted institutes. No Mushlam refund for privately paid imaging was found. Source checked: https://www.clalit.co.il/he/myrights/medical-tests/Pages/mri.aspx

### lab_tests
**not-found.** No Mushlam refund for private lab tests was found. Mushlam's "מעבדה עד הבית" for seniors is a network service.

### alternative_medicine
**Network only, no reimbursement.** Quote: "עד 20 טיפולים בשנה קלנדרית במגוון תחומים ב- 60% הנחה ברשת מרפאות כללית רפואה משלימה". Source: https://mushlam.clalit.co.il/he/Pages/compare.aspx. Confidence: verified-official.

### glasses_lenses
**Network only, no reimbursement** (Zahav: subsidized children's optics in the Clalit Optic network). Source: https://mushlam.clalit.co.il/he/child/Pages/kids_optic.aspx. Confidence: secondary-source (summary only; no refund track found).

### dental
**Network only, no reimbursement.** Mushlam gives a 25% discount on restorative care in Clalit Smile. Quote: "לא יינתנו החזרים בעבור טיפולים שנעשו באופן פרטי ולא דרך כללית, אלא במקרים חריגים." Source: https://www.clalit.co.il/he/myrights/children/Pages/dental-treatments-u18.aspx. Confidence: verified-official.

### medical_devices: מדרסים (orthotic insoles), מסלול החזר
```json
{ "percent": 100, "perSessionCapAgorot": 46200, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": null, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": null, "maxAge": null }
```
- Quote: "לקוחות כללית מושלם זכאים להחזר של עד 462 ש"ח בעבור זוג מדרסים, אך לא יותר מההוצאה בפועל"; "הזכאות הינה אחת לשנתיים"; "לא מותנית בתקופת המתנה".
- Source: https://mushlam.clalit.co.il/he/products/Pages/Arch_support.aspx (undated)
- Does not fit the format: the limit is **once per 2 years** (one pair). The referral must be from an orthopedist.
- **Hearing aids:**
  - The basic-basket refund track closed on 10.3.2024.
  - The Mushlam page says the Mushlam refund is "בהתאם למצוין בתקנון", with a figure of 3,078 ₪ (up to the basket share) for a non-network supplier.
  - Another page mentions up to 1,218 ₪ per year with 6 months of seniority.
  - These figures are inconsistent, so hearing aids are **not-found / unverified**. Source: https://mushlam.clalit.co.il/he/products/Pages/earing_aid.aspx
- Confidence (insoles): **verified-official**.

---

## 2. clalit_platinum (כללית מושלם פלטינום)

Platinum members get **all Zahav rules above**. Only the differences are listed here.

### specialist_visit / second_opinion
Same as Zahav (80%, up to 715 ₪, 3 per year, 6-month waiting period). Quote: "בשתי התוכניות ניתנים 3 ייעוצים בשנה עם רופא מומחה". Source: https://mushlam.clalit.co.il/he/Pages/compare.aspx. Confidence: verified-official.

### physiotherapy
Same as Zahav. No Platinum-specific physiotherapy refund was found.

### child_development
Same 75% / 125 ₪ rule. **+25 treatments per year** on top of Zahav: up to **70** per year for ages 3–9 and **55** per year for ages 10–18.
```json
{ "percent": 75, "perSessionCapAgorot": 12500, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 70, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": 3, "maxAge": 9 }
```
```json
{ "percent": 75, "perSessionCapAgorot": 12500, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 55, "deductibleAgorot": 0, "requiredDocs": ["receipt","referral"], "minAge": 10, "maxAge": 17 }
```
- Quote: "לקוחות פלטינום זכאים ל-25 טיפולים נוספים בכל שנה קלנדרית"
- Sources: https://mushlam.clalit.co.il/he/development/Pages/development_3-10_years.aspx ; https://www.clalit.co.il/he/myrights/child-development/Pages/default.aspx
- Confidence: verified-official (same caveats as Zahav, including the MoH reform).

### psychology
- Children: as in Zahav, within the child-development pool, which is larger for Platinum.
- **Oncology patients only:** the Platinum oncology package refunds "75% מההוצאות, עד 11,307 ש"ח" for medical and nutritional consultation **and psychological treatment**. The scope of the cap (per year or lifetime) is unclear, so this is not encoded as a general rule. Source: https://mushlam.clalit.co.il/he/Pages/platinum-services.aspx. Confidence: secondary-source (search summary of an official page).
- General adult psychology: **not-found** / network only.

### glasses_lenses
**Network only, no reimbursement.** Quote: "אופטיקה לילדים עד גיל 18 (לא כולל), המבוטחים בתוכנית כללית מושלם פלטינום, זכאים למשקפי ראיה בשווי של עד 600 ש"ח חינם, פעם בשנה קלנדרית" (in the Clalit Optic network). Source: https://mushlam.clalit.co.il/he/Pages/compare.aspx. Confidence: verified-official.

### dental
**Network only.** Prosthetic treatment at 50% off in Clalit Smile after 12 months; orthodontics at 60% off under 18 and 50% off for adults. No refund. Confidence: verified-official.

### alternative_medicine, diagnostic_imaging, lab_tests, medical_devices
Same as Zahav: alternative medicine is network only; imaging and labs are not-found; insoles 462 ₪ once per 2 years.

---

## 3. maccabi_zahav (מכבי זהב)

### specialist_visit: התייעצות עם רופאים מומחים בארץ (חוות דעת שנייה), מסלול החזר
```json
{ "percent": 80, "perSessionCapAgorot": 73082, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 3, "deductibleAgorot": 0, "requiredDocs": ["receipt","visit_summary"], "minAge": null, "maxAge": null }
```
- Quote: "אם שולם מחיר מלא - יינתן החזר בגובה 80% ועד לתקרה של 730.82 ₪, הנמוך מביניהם"; "עד 3 פגישות ייעוץ בשנה קלנדרית עם רופאים מומחים בארץ המופיעים במדריך השירותים ברשימת היועצים בשירותי הבריאות הנוספים"
- Sources: https://www.maccabi4u.co.il/eligibilites/4335/ ; the תקנון (Aug 2026) https://www.maccabi4u.co.il/media/lxtetxif/maccabi_zahav_regulations.pdf states **730.79 ₪**. An older page gives 620 ₪.
- Waiting period: **6 months**.
- Conditions:
  - Only consultants on the list, at the listed clinic address, and only for the member's own medical problem.
  - "לא יינתן החזר על השתתפות עצמית ששולמה", so a visit with an in-network consultant paid at co-pay is not refunded.
  - The member can claim from Maccabi in addition to private insurance (refund track only).
  - Documents: a medical summary letter from the consulting doctor plus the original receipt and invoice.
  - +1 extra consultation per year for active oncology disease.
- Confidence: **verified-official**.

### second_opinion
Same benefit and rule. Maccabi titles it "התייעצות עם רופאים מומחים בארץ (חוות דעת שנייה)".

### physiotherapy
**Network only, no reimbursement.**
- Quote (תקנון Aug 2026): "מכבי זהב לא תישא בכל השתתפות בגין ביצוע טיפולים אצל מטפל שאינו בהסכם".
- Zahav supplementary therapy pool (speech, OT, physio, psychology, social work), after using up the basket: up to 30 per year and 100 per membership period, with a per-treatment co-pay in network.
- Exception: hydrotherapy at a pool under a "refund arrangement" refunds up to 278 ₪ per treatment (41 ₪ quarterly co-pay). Source: https://www.maccabi4u.co.il/eligibilites/3436/
- Confidence: verified-official.

### psychology
**Network only, no reimbursement.** Quote: there is no refund for private mental-health services; therapists under agreement charge 70 ₪ intake and 170 ₪ per session. Source: https://www.maccabi4u.co.il/eligibilites/2084/. Confidence: verified-official.

### child_development
**Network only (Zahav), no reimbursement.**
- Zahav gives up to 30 supplementary treatments per year (ages 3–17, max 2 per week, 100 per membership period) at network co-pay.
- The **basic-basket** private-refund track (refund = min(price, cap) − co-pay; example: speech therapy price 300, cap 273, co-pay 36.50 → refund 236.50) is being **phased out under the MoH reform from 1.2.2026**. It remains only with written prior approval for continuing patients (no gap of more than 6 months), autism/somatic cases without an alternative, or remote areas.
- Sources: https://www.maccabi4u.co.il/eligibilites/2711/ ; https://www.maccabi4u.co.il/maccabi_circles/child_development/child_services_reform/
- Confidence: verified-official (the refund is basket, not שב"ן).

### diagnostic_imaging
**not-found.** CT/MRI is a basket service via commitment form (התחייבות) or a post-hoc request to the national imaging center. No Zahav refund was found. Source: https://www.maccabi4u.co.il/eligibilites/3984

### lab_tests
**not-found.**

### alternative_medicine
**Network only, no reimbursement.** Maccabi Tivi discounted price list (about 56% off list for the first treatments each year). The תקנון says there is no participation for a non-agreement therapist. Sources: https://www.maccabi4u.co.il/eligibilites/3611/ ; https://www.maccabi4u.co.il/media/m3gbwxya/maccabi_tivei_costs.pdf (Jan 2026). Confidence: verified-official.

### glasses_lenses
**Network only, no reimbursement.**
- Benefits are realized at "מכבי ממבט ראשון": children without a diagnosis get up to 600 ₪ per pair per year; members with a medical diagnosis are covered after 12 months.
- A refund is given only to residents of localities more than 30 km from the chain, with prior approval.
- Source: https://www.maccabi4u.co.il/eligibilites/5167/
- Confidence: verified-official.

### dental
**Network only, no reimbursement** (Maccabident). A refund applies only when Maccabident is more than 30 km away, with prior approval, and is paid at the Maccabident tariff. Source: https://www.maccabi4u.co.il/eligibilites/3690/. Confidence: verified-official.

### medical_devices
**Network only, no reimbursement.**
- Hearing aids: after 12 months, a reduced co-pay at authorized suppliers, once per 3.5 years.
- Hearing accessories: Zahav pays 83% up to 1,796 ₪ **directly to the supplier**.
- Quote: "לא יינתן החזר על אביזר שנרכש באופן פרטי".
- Sources: https://www.maccabi4u.co.il/eligibilites/1697/ ; https://www.maccabi4u.co.il/eligibilites/2361/
- Confidence: verified-official.

---

## 4. maccabi_sheli (מכבי שלי)

Sheli members get **all Zahav rules above**. Sheli add-ons relevant to these categories:

### specialist_visit / second_opinion
Base: the same rule as Zahav (80%, up to 730.82 ₪, 3 per year). Add-ons:
- **Age 65+:** 2 additional consultations per calendar year after the Zahav quota is used up (5 in total). Waiting period: **12 months** from joining Sheli.
- Pregnant members: extra consultations.
- Active oncology at 65+: +2 more.
- Conflicting caps for the add-on: the eligibility page shows 80% up to **1,336 ₪** on one extract and 730.82 ₪ on another, and the Sheli תקנון extract mentions **824.82 ₪**. The add-on rule below uses the conservative 730.82 cap. **Verify.**
```json
{ "percent": 80, "perSessionCapAgorot": 73082, "perSessionFixedAgorot": null, "annualCapAgorot": null,
  "annualSessions": 2, "deductibleAgorot": 0, "requiredDocs": ["receipt","visit_summary"], "minAge": 65, "maxAge": null }
```
- Sources: https://www.maccabi4u.co.il/eligibilites/2221/ ; https://www.maccabi4u.co.il/media/no1nug5m/maccabi_sheli_regulations.pdf (Aug 2026)
- Confidence: base rule verified-official. The 65+ add-on cap is **secondary-source/unverified** because the official extracts conflict.

### Other categories
- physiotherapy, psychology, alternative_medicine, glasses_lenses, dental, medical_devices: **network only, no reimbursement** (same as Zahav). Sheli adds network discounts, for example dental discounts for ages 18–72 and children's glasses, but no private-refund track was found.
- child_development: network only. Sheli adds extra developmental treatments for children with somatic disabilities (network).
- diagnostic_imaging, lab_tests: **not-found**.

Other Sheli refunds (not target categories): pregnancy package 75% up to 2,358.97 ₪ per pregnancy; post-birth recovery 75% up to 471.32 ₪ per night; post-hospitalization recovery at 65+ 50% up to 304.51 ₪ per night. Source: https://www.maccabi4u.co.il/eligibilites/2673

---

## Summary table

| Category | Clalit Zahav | Clalit Platinum | Maccabi Zahav | Maccabi Sheli |
|---|---|---|---|---|
| specialist_visit | 80% ≤715₪, 3/yr, 6m wait | = Zahav | 80% ≤730.82₪, 3/yr, 6m wait | = Zahav (+2/yr at 65+) |
| second_opinion | same benefit as specialist | same | same | same |
| physiotherapy | 75% ≤111₪, 24/yr, 18+ | = Zahav | network only | network only |
| psychology | children only (child-dev pool, 75% ≤125₪); adults network | + oncology package | network only | network only |
| child_development | 75% ≤125₪; 45/yr (3–9), 30/yr (10–17) | 70/yr, 55/yr | network only (basket refund being phased out) | network only |
| diagnostic_imaging | not found | not found | not found | not found |
| lab_tests | not found | not found | not found | not found |
| alternative_medicine | network only | network only | network only | network only |
| glasses_lenses | network only | network only | network only (refund only if >30 km) | network only |
| dental | network only | network only | network only (refund only if >30 km) | network only |
| medical_devices | insoles ≤462₪ / 2 yrs | = Zahav | network only | network only |
