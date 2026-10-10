// Stock platform metadata profiles. This is the one place to update limits.
//
// Basis tells you how well each number is backed up:
// - "official": stated on the platform's own published help page
// - "reported": only found on third-party pages, and sources may disagree
// - "assumed": a common safe target used because no confirmed limit was found

export type PlatformId =
  | "all"
  | "adobe-stock"
  | "shutterstock"
  | "freepik"
  | "vecteezy"
  | "pond5"
  | "123rf"
  | "dreamstime";

export type Basis = "official" | "reported" | "assumed";

export type PlatformProfile = {
  id: PlatformId;
  name: string;
  titleMaxChars: number;
  titleBasis: Basis;
  descriptionMaxChars: number;
  descriptionBasis: Basis;
  /** null means no minimum is enforced or warned about. */
  keywordsMin: number | null;
  keywordsMax: number;
  keywordsBasis: Basis;
  note: string;
  sourceUrl?: string;
};

const SAFE_TITLE_MAX = 70;
const SAFE_DESCRIPTION_MAX = 180;
const SAFE_KEYWORDS_MIN = 7;
const SAFE_KEYWORDS_MAX = 49;

const PROVISIONAL_NOTE =
  "Provisional: this platform's own limits were not confirmed yet, so common safe targets are used. Check the platform's contributor page before uploading.";

function provisional(id: PlatformId, name: string): PlatformProfile {
  return {
    id,
    name,
    titleMaxChars: SAFE_TITLE_MAX,
    titleBasis: "assumed",
    descriptionMaxChars: SAFE_DESCRIPTION_MAX,
    descriptionBasis: "assumed",
    keywordsMin: SAFE_KEYWORDS_MIN,
    keywordsMax: SAFE_KEYWORDS_MAX,
    keywordsBasis: "assumed",
    note: PROVISIONAL_NOTE,
  };
}

export const DEFAULT_PLATFORM_ID: PlatformId = "all";

export const PLATFORM_PROFILES: PlatformProfile[] = [
  {
    ...provisional("all", "All Platforms"),
    note: "Neutral metadata that uses the strictest common targets. It does not guarantee that every platform will accept it. Check each platform's rules before uploading.",
  },
  {
    id: "adobe-stock",
    name: "Adobe Stock",
    titleMaxChars: 70,
    titleBasis: "official",
    descriptionMaxChars: SAFE_DESCRIPTION_MAX,
    descriptionBasis: "assumed",
    keywordsMin: null,
    keywordsMax: 49,
    keywordsBasis: "official",
    note: "Adobe's help page recommends titles of 70 characters or fewer and allows up to 49 keywords. It does not state a description limit, so 180 characters is a safe assumption.",
    sourceUrl: "https://helpx.adobe.com/stock/contributor/help/titles-and-keyword",
  },
  {
    id: "shutterstock",
    name: "Shutterstock",
    titleMaxChars: 200,
    titleBasis: "reported",
    descriptionMaxChars: 200,
    descriptionBasis: "reported",
    keywordsMin: 7,
    keywordsMax: 50,
    keywordsBasis: "reported",
    note: "Shutterstock uses one description field. Third-party guides report up to 200 characters and 7 to 50 keywords, but they disagree on the length. Not confirmed from Shutterstock's own pages.",
  },
  provisional("freepik", "Freepik"),
  provisional("vecteezy", "Vecteezy"),
  provisional("pond5", "Pond5"),
  {
    ...provisional("123rf", "123RF"),
    descriptionMaxChars: 180,
    descriptionBasis: "reported",
    note: "A third-party guide reports a 180-character description limit. The other limits are provisional. Check 123RF's contributor page before uploading.",
  },
  provisional("dreamstime", "Dreamstime"),
];

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && PLATFORM_PROFILES.some((profile) => profile.id === value);
}

export function getPlatformProfile(id: string): PlatformProfile {
  return PLATFORM_PROFILES.find((profile) => profile.id === id) ?? PLATFORM_PROFILES[0];
}

/** The keyword count actually requested: never above what the platform allows. */
export function effectiveKeywordCount(profile: PlatformProfile, requested: number): number {
  const whole = Number.isFinite(requested) ? Math.floor(requested) : profile.keywordsMax;
  return Math.max(1, Math.min(whole, profile.keywordsMax));
}

export function profileStatusLabel(profile: PlatformProfile): string {
  const bases = [profile.titleBasis, profile.descriptionBasis, profile.keywordsBasis];
  if (bases.every((basis) => basis === "official")) {
    return "Confirmed";
  }
  if (bases.some((basis) => basis === "official")) {
    return "Partly confirmed";
  }
  if (bases.some((basis) => basis === "reported")) {
    return "Third-party reported";
  }
  return "Provisional";
}

export function describeProfile(profile: PlatformProfile): string {
  const keywordRange =
    profile.keywordsMin === null
      ? `up to ${profile.keywordsMax}`
      : `${profile.keywordsMin} to ${profile.keywordsMax}`;
  return `Title up to ${profile.titleMaxChars} characters, description up to ${profile.descriptionMaxChars} characters, keywords ${keywordRange}.`;
}