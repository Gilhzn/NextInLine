export const BENEFIT_CATEGORIES = [
  "specialist_visit",
  "physiotherapy",
  "psychology",
  "child_development",
  "diagnostic_imaging",
  "lab_tests",
  "alternative_medicine",
  "glasses_lenses",
  "dental",
  "second_opinion",
  "medical_devices",
  "other",
] as const;

export type BenefitCategory = (typeof BENEFIT_CATEGORIES)[number];

interface CategoryInfo {
  label: string;
  icon: string;
  keywords: string[];
}

export const CATEGORY_INFO: Record<BenefitCategory, CategoryInfo> = {
  specialist_visit: {
    label: "רופא מומחה",
    icon: "🩺",
    keywords: [
      "רופא",
      "מומחה",
      "אורתופד",
      "דרמטולוג",
      "עור",
      "קרדיולוג",
      "גינקולוג",
      "נוירולוג",
      "אף אוזן גרון",
      "אאג",
      "רופא ילדים",
      "אנדוקרינולוג",
      "גסטרו",
      "אורולוג",
      "עיניים",
      "specialist",
    ],
  },
  physiotherapy: {
    label: "פיזיותרפיה",
    icon: "🦴",
    keywords: ["פיזיו", "פיזיותרפיה", "פיזיותרפיסט", "physio"],
  },
  psychology: {
    label: "טיפול רגשי ופסיכולוג",
    icon: "🧠",
    keywords: ["פסיכולוג", "פסיכותרפיה", "טיפול רגשי", "פסיכיאטר", "מטפל", "עובדת סוציאלית", "psych"],
  },
  child_development: {
    label: "התפתחות הילד",
    icon: "🧒",
    keywords: ["ריפוי בעיסוק", "קלינאית", "קלינאי", "תקשורת", "התפתחות", "רב תחומי"],
  },
  diagnostic_imaging: {
    label: "בדיקות הדמיה",
    icon: "🔬",
    keywords: ["mri", "ct", "סי טי", "אולטרסאונד", "רנטגן", "הדמיה", "מיפוי", "פט"],
  },
  lab_tests: {
    label: "בדיקות מעבדה",
    icon: "🧪",
    keywords: ["בדיקת דם", "מעבדה", "בדיקות דם", "גנטית", "סקירה"],
  },
  alternative_medicine: {
    label: "רפואה משלימה",
    icon: "🌿",
    keywords: ["דיקור", "כירופרקט", "נטורופת", "שיאצו", "רפלקסולוגיה", "הומאופתיה", "אוסטאופת", "משלימה"],
  },
  glasses_lenses: {
    label: "משקפיים ועדשות",
    icon: "👓",
    keywords: ["משקפיים", "עדשות", "אופטיקה", "אופטומטריסט"],
  },
  dental: {
    label: "שיניים",
    icon: "🦷",
    keywords: ["שיניים", "רופא שיניים", "שיננית", "יישור", "אורתודנט"],
  },
  second_opinion: {
    label: "חוות דעת שנייה",
    icon: "📋",
    keywords: ["חוות דעת", "דעה שנייה", "חוות דעת שנייה"],
  },
  medical_devices: {
    label: "אביזרים רפואיים",
    icon: "🦽",
    keywords: ["מדרסים", "מכשיר שמיעה", "אביזר", "מכשיר", "סד", "חגורה"],
  },
  other: {
    label: "אחר",
    icon: "📄",
    keywords: [],
  },
};

/** Matches free text ("פסיכולוג", "MRI ברך") to the most likely categories, best first. */
export function searchCategories(query: string): BenefitCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ category: BenefitCategory; score: number }> = [];
  for (const category of BENEFIT_CATEGORIES) {
    const info = CATEGORY_INFO[category];
    let score = 0;
    if (info.label.toLowerCase().includes(q)) score += 3;
    for (const kw of info.keywords) {
      if (q.includes(kw) || kw.includes(q)) score = Math.max(score, kw === q ? 4 : 2);
    }
    if (score > 0) scored.push({ category, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.category);
}

/**
 * A typical private price in Israel (2026) per visit / item, used only for worked examples and estimates
 * ("on a visit of ₪650 you'd get back ₪520"). Always shown as an example the user can change.
 */
export const TYPICAL_PRICE_AGOROT: Record<BenefitCategory, number> = {
  specialist_visit: 65000,
  physiotherapy: 25000,
  psychology: 45000,
  child_development: 35000,
  diagnostic_imaging: 180000,
  lab_tests: 30000,
  alternative_medicine: 30000,
  glasses_lenses: 120000,
  dental: 80000,
  second_opinion: 150000,
  medical_devices: 200000,
  other: 40000,
};
