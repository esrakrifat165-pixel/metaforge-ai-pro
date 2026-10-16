// Event model, date helpers, built-in catalog and CSV export for the Global Event Calendar.
// All dates are date-only strings (YYYY-MM-DD) and are computed with UTC math,
// so an all-day event can never slip to the previous or next day.

export const CATEGORIES = [
  { id: "public", label: "Public Holidays" },
  { id: "cultural", label: "Religious & Cultural" },
  { id: "commercial", label: "Commercial & Shopping" },
  { id: "seasonal", label: "Seasonal" },
  { id: "environmental", label: "Environmental" },
  { id: "awareness", label: "International Awareness" },
  { id: "business", label: "Business & Marketing" },
  { id: "stock", label: "Design & Stock Content" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORIES.some((category) => category.id === value);
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export const EVENT_TYPES = [
  { id: "holiday", label: "Holiday" },
  { id: "commercial", label: "Commercial event" },
  { id: "observance", label: "Observance" },
  { id: "custom", label: "Custom" },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]["id"];

export function eventTypeLabel(id: EventType): string {
  return EVENT_TYPES.find((type) => type.id === id)?.label ?? id;
}

export type Verification = "rule" | "user";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  category: CategoryId;
  eventType: EventType;
  /** ISO 3166 alpha-2 codes. Empty means worldwide / not country-specific. */
  countryCodes: string[];
  tags: string[];
  contentIdeas: string[];
  leadTime?: string;
  sourceUrl?: string;
  verification: Verification;
  isCustom: boolean;
};

export function verificationLabel(value: Verification): string {
  return value === "user"
    ? "Created by you"
    : "Date follows a fixed or calendar rule. Not a live feed. Check local announcements.";
}

/* ---------- Dates ---------- */

export type YMD = { y: number; m: number; d: number };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDate(value: string): YMD | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function toDateStr(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dayNumber(value: string): number {
  const p = parseDate(value);
  return p ? Date.UTC(p.y, p.m - 1, p.d) / 86_400_000 : Number.NaN;
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(value: string, days: number): string {
  const p = parseDate(value);
  if (!p) {
    return value;
  }
  const result = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return toDateStr(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

/** First day of the month, shifted by `months`. Works across year boundaries. */
export function addMonths(value: string, months: number): string {
  const p = parseDate(value);
  if (!p) {
    return value;
  }
  const result = new Date(Date.UTC(p.y, p.m - 1 + months, 1));
  return toDateStr(result.getUTCFullYear(), result.getUTCMonth() + 1, 1);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function weekdayOf(value: string): number {
  const p = parseDate(value);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : 0;
}

export function formatDate(value: string): string {
  const p = parseDate(value);
  return p ? `${MONTH_NAMES[p.m - 1].slice(0, 3)} ${p.d}, ${p.y}` : value;
}

export function monthLabel(value: string): string {
  const p = parseDate(value);
  return p ? `${MONTH_NAMES[p.m - 1]} ${p.y}` : value;
}

export function todayLocal(): string {
  const now = new Date();
  return toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function endOf(event: CalendarEvent): string {
  return event.endDate ?? event.startDate;
}

/** n-th given weekday (0 = Sunday) of a month (1-12). */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return toDateStr(year, month, day);
}

/** Western (Gregorian) Easter Sunday. Orthodox Easter can fall on a different date. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toDateStr(year, month, day);
}

/* ---------- Built-in catalog ---------- */

type Rule = {
  key: string;
  title: string;
  description: string;
  category: CategoryId;
  eventType: EventType;
  countryCodes: string[];
  tags: string[];
  contentIdeas: string[];
  leadTime: string;
  date: (year: number) => string;
};

function fixed(month: number, day: number): (year: number) => string {
  return (year) => toDateStr(year, month, day);
}

const thanksgiving = (year: number) => nthWeekday(year, 11, 4, 4);

const RULES: Rule[] = [
  {
    key: "new-year",
    title: "New Year's Day",
    description: "First day of the Gregorian year. A public holiday in most, but not all, countries.",
    category: "public",
    eventType: "holiday",
    countryCodes: [],
    tags: ["new year", "celebration", "fireworks"],
    contentIdeas: ["Fireworks and countdown backgrounds", "Resolution and planner templates", "Gold and midnight-blue greeting cards"],
    leadTime: "8 to 10 weeks before",
    date: fixed(1, 1),
  },
  {
    key: "valentines",
    title: "Valentine's Day",
    description: "Widely marked gift-giving day. A commercial occasion, not a public holiday.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: [],
    tags: ["valentine", "love", "romance", "hearts"],
    contentIdeas: ["Heart and flower backgrounds", "Gift and flat-lay scenes with copy space", "Social post and banner templates"],
    leadTime: "8 to 10 weeks before",
    date: fixed(2, 14),
  },
  {
    key: "womens-day",
    title: "International Women's Day",
    description: "UN-recognised observance celebrating women's achievements. A public holiday only in some countries.",
    category: "awareness",
    eventType: "observance",
    countryCodes: [],
    tags: ["women", "equality", "empowerment"],
    contentIdeas: ["Diverse and empowered women illustrations", "Purple-toned banner backgrounds", "Business and leadership scenes"],
    leadTime: "6 to 8 weeks before",
    date: fixed(3, 8),
  },
  {
    key: "st-patricks",
    title: "St. Patrick's Day",
    description: "Irish cultural and religious feast, celebrated by Irish communities worldwide.",
    category: "cultural",
    eventType: "observance",
    countryCodes: [],
    tags: ["st patrick", "clover", "green", "ireland"],
    contentIdeas: ["Shamrock and green patterns", "Pub and parade-themed backgrounds", "Gold coin and rainbow graphics"],
    leadTime: "6 to 8 weeks before",
    date: fixed(3, 17),
  },
  {
    key: "easter",
    title: "Easter Sunday (Western)",
    description: "Calculated with the Gregorian Easter rule. Orthodox churches often celebrate on a different date.",
    category: "cultural",
    eventType: "holiday",
    countryCodes: [],
    tags: ["easter", "spring", "eggs", "bunny"],
    contentIdeas: ["Pastel egg and spring floral backgrounds", "Egg hunt scenes", "Brunch table flat lays"],
    leadTime: "8 to 12 weeks before",
    date: easterSunday,
  },
  {
    key: "earth-day",
    title: "Earth Day",
    description: "Annual environmental awareness day.",
    category: "environmental",
    eventType: "observance",
    countryCodes: [],
    tags: ["earth", "environment", "eco", "sustainability"],
    contentIdeas: ["Green planet and nature icons", "Recycling and renewable-energy scenes", "Eco-friendly packaging mockups"],
    leadTime: "6 to 8 weeks before",
    date: fixed(4, 22),
  },
  {
    key: "workers-day",
    title: "International Workers' Day",
    description: "Public holiday in many countries on 1 May. Not a public holiday in the United States.",
    category: "public",
    eventType: "holiday",
    countryCodes: [],
    tags: ["labour", "workers", "may day"],
    contentIdeas: ["Diverse workforce illustrations", "Tools and trades backgrounds", "Banner templates with copy space"],
    leadTime: "6 to 8 weeks before",
    date: fixed(5, 1),
  },
  {
    key: "mothers-day-us",
    title: "Mother's Day (United States)",
    description: "Second Sunday of May in the United States. Other countries use different dates.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: ["US"],
    tags: ["mother", "family", "flowers", "gift"],
    contentIdeas: ["Floral bouquet backgrounds", "Mother-and-child lifestyle scenes", "Gift card and brunch layouts"],
    leadTime: "8 to 10 weeks before",
    date: (year) => nthWeekday(year, 5, 0, 2),
  },
  {
    key: "world-environment-day",
    title: "World Environment Day",
    description: "UN environment observance held every 5 June.",
    category: "environmental",
    eventType: "observance",
    countryCodes: [],
    tags: ["environment", "nature", "climate"],
    contentIdeas: ["Forest and ocean conservation scenes", "Climate-action infographics", "Plant-a-tree illustrations"],
    leadTime: "6 to 8 weeks before",
    date: fixed(6, 5),
  },
  {
    key: "fathers-day-us",
    title: "Father's Day (United States)",
    description: "Third Sunday of June in the United States. Other countries use different dates.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: ["US"],
    tags: ["father", "dad", "family", "gift"],
    contentIdeas: ["Dad-and-child lifestyle scenes", "Tools, grill and outdoor gift flat lays", "Blue and navy card backgrounds"],
    leadTime: "8 weeks before",
    date: (year) => nthWeekday(year, 6, 0, 3),
  },
  {
    key: "mental-health-day",
    title: "World Mental Health Day",
    description: "Global mental health awareness day on 10 October.",
    category: "awareness",
    eventType: "observance",
    countryCodes: [],
    tags: ["mental health", "wellbeing", "awareness"],
    contentIdeas: ["Calm, supportive wellbeing illustrations", "Meditation and self-care scenes", "Green ribbon graphics"],
    leadTime: "6 weeks before",
    date: fixed(10, 10),
  },
  {
    key: "halloween",
    title: "Halloween",
    description: "Commercial and cultural occasion, strongest in the US, UK, Canada and Ireland.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: [],
    tags: ["halloween", "pumpkin", "spooky", "autumn"],
    contentIdeas: ["Pumpkin and bat patterns", "Haunted house and moonlit backgrounds", "Party invitation templates"],
    leadTime: "10 to 12 weeks before",
    date: fixed(10, 31),
  },
  {
    key: "singles-day",
    title: "Singles' Day (11.11)",
    description: "Large online shopping event that began in China and is now promoted in other markets.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: [],
    tags: ["singles day", "sale", "shopping", "e-commerce"],
    contentIdeas: ["Sale banner and badge templates", "Shopping cart and parcel graphics", "Red and gold promo backgrounds"],
    leadTime: "8 to 10 weeks before",
    date: fixed(11, 11),
  },
  {
    key: "thanksgiving-us",
    title: "Thanksgiving (United States)",
    description: "Fourth Thursday of November in the United States. Canada and other countries use different dates.",
    category: "public",
    eventType: "holiday",
    countryCodes: ["US"],
    tags: ["thanksgiving", "autumn", "harvest", "family"],
    contentIdeas: ["Harvest table and autumn leaf backgrounds", "Gratitude quote layouts", "Turkey dinner flat lays"],
    leadTime: "10 to 12 weeks before",
    date: thanksgiving,
  },
  {
    key: "black-friday",
    title: "Black Friday",
    description: "Retail sale event on the day after US Thanksgiving, now promoted in many countries.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: [],
    tags: ["black friday", "sale", "discount", "shopping"],
    contentIdeas: ["Black and gold sale banners", "Price tag and shopping bag graphics", "Countdown-timer templates"],
    leadTime: "10 to 12 weeks before",
    date: (year) => addDays(thanksgiving(year), 1),
  },
  {
    key: "cyber-monday",
    title: "Cyber Monday",
    description: "Online sale event on the Monday after US Thanksgiving.",
    category: "commercial",
    eventType: "commercial",
    countryCodes: [],
    tags: ["cyber monday", "online shopping", "tech", "deals"],
    contentIdeas: ["Neon tech-style sale backgrounds", "Laptop and mobile shopping scenes", "Deal badge and coupon graphics"],
    leadTime: "10 to 12 weeks before",
    date: (year) => addDays(thanksgiving(year), 4),
  },
  {
    key: "human-rights-day",
    title: "Human Rights Day",
    description: "UN observance on 10 December.",
    category: "awareness",
    eventType: "observance",
    countryCodes: [],
    tags: ["human rights", "equality", "justice"],
    contentIdeas: ["Unity and diversity illustrations", "Dove and peace symbols", "Banner templates with copy space"],
    leadTime: "6 weeks before",
    date: fixed(12, 10),
  },
  {
    key: "christmas",
    title: "Christmas Day",
    description: "Public holiday in many countries. Not observed as a holiday everywhere.",
    category: "public",
    eventType: "holiday",
    countryCodes: [],
    tags: ["christmas", "holiday", "winter", "xmas"],
    contentIdeas: ["Christmas tree and ornament backgrounds", "Snowy winter scenes", "Gift wrapping flat lays", "Greeting card templates"],
    leadTime: "12 to 16 weeks before",
    date: fixed(12, 25),
  },
  {
    key: "new-years-eve",
    title: "New Year's Eve",
    description: "Evening before New Year's Day, celebrated in most countries.",
    category: "cultural",
    eventType: "observance",
    countryCodes: [],
    tags: ["new year", "party", "countdown", "champagne"],
    contentIdeas: ["Glitter and champagne backgrounds", "Countdown clock graphics", "Party invitation layouts"],
    leadTime: "10 to 12 weeks before",
    date: fixed(12, 31),
  },
];

export const CATALOG_FIRST_YEAR = 2024;
export const CATALOG_LAST_YEAR = 2032;

export function buildCatalog(fromYear: number, toYear: number): CalendarEvent[] {
  const first = Math.max(CATALOG_FIRST_YEAR, fromYear);
  const last = Math.min(CATALOG_LAST_YEAR, toYear);
  const events: CalendarEvent[] = [];
  for (let year = first; year <= last; year += 1) {
    for (const rule of RULES) {
      events.push({
        id: `${rule.key}-${year}`,
        title: rule.title,
        description: rule.description,
        startDate: rule.date(year),
        category: rule.category,
        eventType: rule.eventType,
        countryCodes: rule.countryCodes,
        tags: rule.tags,
        contentIdeas: rule.contentIdeas,
        leadTime: rule.leadTime,
        verification: "rule",
        isCustom: false,
      });
    }
  }
  return events;
}

/* ---------- Stored data (custom events and favorites) ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toCustomEvent(value: unknown): CalendarEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, title, startDate, endDate, category } = value;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    title.trim() === "" ||
    typeof startDate !== "string" ||
    parseDate(startDate) === null ||
    !isCategoryId(category)
  ) {
    return null;
  }
  let end: string | undefined;
  if (typeof endDate === "string" && endDate !== "") {
    if (parseDate(endDate) === null || endDate < startDate) {
      return null;
    }
    end = endDate;
  }
  return {
    id,
    title: title.slice(0, 120),
    description: typeof value.description === "string" ? value.description.slice(0, 2000) : "",
    startDate,
    endDate: end,
    category,
    eventType: "custom",
    countryCodes: stringArray(value.countryCodes).filter((code) => /^[A-Z]{2}$/.test(code)),
    tags: stringArray(value.tags).slice(0, 20),
    contentIdeas: stringArray(value.contentIdeas).slice(0, 20),
    verification: "user",
    isCustom: true,
  };
}

/** Reads stored custom events. Invalid or outdated data is skipped, never thrown. */
export function parseCustomEvents(raw: string | null): CalendarEvent[] {
  if (!raw) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  const events: CalendarEvent[] = [];
  for (const item of data) {
    const event = toCustomEvent(item);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

export function parseFavorites(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    return stringArray(data);
  } catch {
    return [];
  }
}

/* ---------- CSV ---------- */

function csvCell(value: string): string {
  // A leading = + - @ can be run as a formula by spreadsheet programs, so a quote is added in front.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildEventsCsv(events: CalendarEvent[]): string {
  const header = [
    "Title", "Start Date", "End Date", "Category", "Country/Scope",
    "Description", "Tags", "Source URL", "Verification Status",
  ]
    .map(csvCell)
    .join(",");

  const lines = events.map((event) =>
    [
      event.title,
      event.startDate,
      event.endDate ?? event.startDate,
      categoryLabel(event.category),
      event.countryCodes.length > 0 ? event.countryCodes.join(" ") : "Global",
      event.description,
      event.tags.join("; "),
      event.sourceUrl ?? "",
      event.verification === "user" ? "Created by user" : "Rule-based date (not a live feed)",
    ]
      .map(csvCell)
      .join(","),
  );
  return "\uFEFF" + [header, ...lines].join("\r\n");
}