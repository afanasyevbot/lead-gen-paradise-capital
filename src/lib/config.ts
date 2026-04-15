export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const SERPER_API_KEY = process.env.SERPER_API_KEY || process.env.serper || "";

export const KNOWN_CHAINS = new Set([
  "jiffy lube", "meineke", "midas", "valvoline", "pep boys",
  "home depot", "lowes", "ace hardware",
  "servpro", "servicemaster", "stanley steemer",
  "roto-rooter", "mr. rooter", "benjamin franklin plumbing",
  "one hour heating", "aire serv",
  "trugreen", "lawn doctor",
  "maaco", "caliber collision", "gerber collision",
]);

export const SEARCH_PRESETS: Record<string, string[]> = {
  // ── Trades & Field Services ──────────────────────────────────────────────
  marine: [
    "marina", "boat dealer", "marine repair", "yacht club",
    "boat storage", "marine services", "boat yard",
  ],
  hvac: [
    "HVAC contractor", "heating and cooling company",
    "AC repair company", "HVAC company",
  ],
  landscaping: [
    "landscaping company", "lawn care service", "tree service company",
  ],
  plumbing: ["plumbing company", "plumber"],
  manufacturing: [
    "manufacturer", "fabrication shop", "machine shop", "metal fabrication",
  ],
  construction: [
    "general contractor", "construction company",
    "roofing company", "commercial contractor",
  ],
  auto: ["auto body shop", "auto repair shop", "car dealership"],
  electrical: ["electrical contractor", "electrician company"],
  "pest-control": ["pest control company", "exterminator"],
  waste: ["waste management company", "dumpster rental", "junk removal company"],
  roofing: [
    "roofing company", "roofing contractor", "commercial roofing",
    "roof installation company",
  ],
  trucking: [
    "trucking company", "freight company", "logistics company",
    "transportation company", "regional carrier",
  ],
  "fire-security": [
    "fire protection company", "fire suppression company",
    "security systems company", "alarm company",
  ],

  // ── Professional & Business Services ────────────────────────────────────
  "consulting": [
    "consulting firm", "management consulting", "business consulting company",
    "strategy consulting", "operations consulting",
  ],
  "marketing-agency": [
    "marketing agency", "advertising agency", "digital marketing agency",
    "creative agency", "branding agency", "PR firm",
  ],
  "staffing": [
    "staffing agency", "employment agency", "recruiting firm",
    "temp agency", "workforce solutions",
  ],
  "accounting": [
    "accounting firm", "CPA firm", "bookkeeping company",
    "tax advisory firm",
  ],
  "insurance": [
    "independent insurance agency", "insurance brokerage",
    "commercial insurance agency", "P&C insurance agency",
  ],
  "engineering": [
    "engineering firm", "civil engineering company",
    "structural engineering firm", "environmental engineering",
    "surveying company",
  ],
  "architecture": [
    "architecture firm", "architectural design firm",
    "commercial architect",
  ],
  "it-services": [
    "IT services company", "managed services provider",
    "IT consulting firm", "technology consulting",
    "network services company",
  ],

  // ── Media, Print & Creative ──────────────────────────────────────────────
  "printing": [
    "commercial printing company", "print shop",
    "commercial printer", "offset printing company",
    "digital printing company", "large format printing",
    "signage company", "label printing company",
    "packaging company", "direct mail company",
    "promotional products company", "screen printing company",
  ],
  "media": [
    "media company", "publishing company", "trade publication",
    "regional magazine", "newsletter company",
  ],

  // Healthcare & senior care excluded — not in PCAP deal profile

  // ── Distribution & Wholesale ─────────────────────────────────────────────
  "distribution": [
    "wholesale distributor", "regional distributor",
    "food distributor", "industrial distributor",
    "supply company",
  ],
  "food-beverage": [
    "food distribution company", "specialty food company",
    "beverage distributor", "food service company",
  ],

  // ── Real Estate & Property ───────────────────────────────────────────────
  "property-services": [
    "property management company", "commercial cleaning company",
    "janitorial services", "facilities management",
  ],

  // ── Education & Training ─────────────────────────────────────────────────
  "education": [
    "private school", "training company", "vocational school",
    "tutoring company", "educational services",
  ],

  // ── Financial & Wealth Management ───────────────────────────────────
  "financial-advisory": [
    "financial advisory firm", "wealth management firm",
    "registered investment advisor", "RIA firm",
    "financial planning firm", "investment advisory",
    "independent financial advisor",
  ],

  // ── Building Materials & Supply ──────────────────────────────────────
  "building-materials": [
    "building materials supplier", "lumber yard", "lumber company",
    "hardware distributor", "building supply company",
    "millwork company", "flooring distributor",
    "roofing materials supplier",
  ],

  // ── Specialty & Contract Manufacturing ──────────────────────────────
  "specialty-manufacturing": [
    "plastics manufacturer", "plastic injection molding",
    "rubber manufacturer", "contract manufacturer",
    "food manufacturer", "food processing company",
    "packaging manufacturer", "custom fabrication company",
    "electronics manufacturer", "precision machining company",
  ],

  // ── Logistics & 3PL ─────────────────────────────────────────────────
  "logistics-3pl": [
    "freight broker", "third party logistics", "3PL company",
    "warehousing company", "fulfillment company",
    "cold storage company", "distribution center",
  ],

  // ── Environmental & Remediation ──────────────────────────────────────
  "environmental": [
    "environmental services company", "environmental consulting firm",
    "remediation company", "environmental engineering firm",
    "industrial cleaning company", "tank cleaning company",
  ],

  // Funeral services excluded — not in PCAP deal profile

  // ── Veterinary & Animal Services ─────────────────────────────────────
  "veterinary": [
    "veterinary practice", "animal hospital", "veterinary clinic",
    "specialty veterinary", "emergency animal hospital",
  ],

  // ── Specialty Supply & Distribution ──────────────────────────────────
  "specialty-supply": [
    "industrial supply company", "safety supply company",
    "janitorial supply distributor", "office supply distributor",
    "uniform company", "workwear company",
  ],
};

// Structural chain/franchise hints — words that almost never appear in
// single-founder businesses. Used for multi-signal chain detection.
const CHAIN_KEYWORDS = [
  "franchise", "franchisee", "franchising",
  "locations nationwide", "national chain", "corporate headquarters",
  "owned and operated by independent", // standard franchise disclaimer
];

export function isChain(name: string): boolean {
  const lower = name.toLowerCase().trim();
  for (const chain of KNOWN_CHAINS) {
    if (lower.includes(chain)) return true;
  }
  return false;
}

/**
 * Multi-signal chain detection. Use when you have more than just a name —
 * e.g. scraped text or review counts. Avoids the 1000-review hard cutoff
 * which burned legitimate $20M+ founder businesses with lots of reviews.
 */
export function looksLikeChain(opts: {
  name: string;
  reviewCount?: number;
  scrapedText?: string | null;
}): boolean {
  if (isChain(opts.name)) return true;
  const text = (opts.scrapedText || "").toLowerCase();
  const hits = CHAIN_KEYWORDS.filter((kw) => text.includes(kw)).length;
  // 500+ reviews alone is no longer disqualifying, but combined with a
  // franchise keyword in scraped text it's a strong signal.
  if ((opts.reviewCount ?? 0) >= 500 && hits >= 1) return true;
  // Two independent franchise-language hits is enough on its own.
  if (hits >= 2) return true;
  return false;
}
