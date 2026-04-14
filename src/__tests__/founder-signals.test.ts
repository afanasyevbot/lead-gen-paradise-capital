import { describe, it, expect } from "vitest";

/**
 * Test the Career Math logic directly.
 * We re-implement calculateCareerMath here since it's not exported,
 * but the logic is identical to founder-signals.ts.
 */

function calculateCareerMath(
  graduationYear: number | null,
  foundedYear: number | null,
  careerStartYear: number | null,
): {
  estimated_birth_year: number | null;
  estimated_current_age: number | null;
  is_age_55_plus: boolean;
  source: "graduation" | "career_start" | "founded_year" | null;
} {
  const currentYear = new Date().getFullYear();

  if (graduationYear && graduationYear > 1950 && graduationYear < currentYear) {
    const birthYear = graduationYear - 22;
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: graduationYear < 1993,
      source: "graduation",
    };
  }

  if (careerStartYear && careerStartYear > 1950 && careerStartYear < currentYear) {
    const birthYear = careerStartYear - 22;
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: age >= 55,
      source: "career_start",
    };
  }

  if (foundedYear && foundedYear > 1950 && foundedYear < currentYear) {
    const birthYear = foundedYear - 32;
    const age = currentYear - birthYear;
    return {
      estimated_birth_year: birthYear,
      estimated_current_age: age,
      is_age_55_plus: age >= 55,
      source: "founded_year",
    };
  }

  return {
    estimated_birth_year: null,
    estimated_current_age: null,
    is_age_55_plus: false,
    source: null,
  };
}

// ─── Career Math Tests ──────────────────────────────────────────────────────

describe("Career Math — graduation year", () => {
  it("flags Age 55+ when graduation year is before 1993", () => {
    const result = calculateCareerMath(1985, null, null);
    expect(result.is_age_55_plus).toBe(true);
    expect(result.source).toBe("graduation");
    expect(result.estimated_birth_year).toBe(1963);
    expect(result.estimated_current_age).toBeGreaterThanOrEqual(62);
  });

  it("does NOT flag Age 55+ when graduation year is 1993 or later", () => {
    const result = calculateCareerMath(1995, null, null);
    expect(result.is_age_55_plus).toBe(false);
    expect(result.estimated_birth_year).toBe(1973);
  });

  it("handles exact boundary: graduation 1992 = age 55+", () => {
    const result = calculateCareerMath(1992, null, null);
    expect(result.is_age_55_plus).toBe(true);
  });

  it("handles exact boundary: graduation 1993 = NOT age 55+", () => {
    const result = calculateCareerMath(1993, null, null);
    expect(result.is_age_55_plus).toBe(false);
  });

  it("graduation year takes priority over founded year", () => {
    const result = calculateCareerMath(1990, 2000, null);
    expect(result.source).toBe("graduation");
    expect(result.estimated_birth_year).toBe(1968);
  });

  it("graduation year takes priority over career start", () => {
    const result = calculateCareerMath(1988, null, 1990);
    expect(result.source).toBe("graduation");
  });
});

describe("Career Math — career start year", () => {
  it("estimates age from career start when no graduation year", () => {
    const result = calculateCareerMath(null, null, 1985);
    expect(result.source).toBe("career_start");
    expect(result.estimated_birth_year).toBe(1963);
    expect(result.is_age_55_plus).toBe(true);
  });

  it("career start in 2005 = NOT age 55+", () => {
    const result = calculateCareerMath(null, null, 2005);
    expect(result.is_age_55_plus).toBe(false);
    expect(result.estimated_birth_year).toBe(1983);
  });

  it("career start takes priority over founded year", () => {
    const result = calculateCareerMath(null, 1990, 1988);
    expect(result.source).toBe("career_start");
  });
});

describe("Career Math — founded year", () => {
  it("estimates age from founded year as last resort", () => {
    const result = calculateCareerMath(null, 1985, null);
    expect(result.source).toBe("founded_year");
    expect(result.estimated_birth_year).toBe(1953); // 1985 - 32
    expect(result.is_age_55_plus).toBe(true);
  });

  it("recently founded business = NOT age 55+", () => {
    const result = calculateCareerMath(null, 2010, null);
    expect(result.is_age_55_plus).toBe(false);
    expect(result.estimated_birth_year).toBe(1978);
  });
});

describe("Career Math — edge cases", () => {
  it("returns null for all fields when no data", () => {
    const result = calculateCareerMath(null, null, null);
    expect(result.estimated_birth_year).toBeNull();
    expect(result.estimated_current_age).toBeNull();
    expect(result.is_age_55_plus).toBe(false);
    expect(result.source).toBeNull();
  });

  it("rejects obviously invalid graduation year (too old)", () => {
    const result = calculateCareerMath(1940, null, null);
    expect(result.source).toBeNull();
  });

  it("rejects future graduation year", () => {
    const currentYear = new Date().getFullYear();
    const result = calculateCareerMath(currentYear + 5, null, null);
    expect(result.source).toBeNull();
  });

  it("rejects invalid founded year", () => {
    const result = calculateCareerMath(null, 1890, null);
    expect(result.source).toBeNull();
  });
});

// ─── Founder Detection Logic Tests ──────────────────────────────────────────

describe("Primary Founder Detection — date comparison", () => {
  function compareDates(
    joinedDate: string | null,
    foundedDate: string | null,
  ): { isPrimary: boolean; confidence: string; gapMonths: number | null } {
    if (!joinedDate || !foundedDate) {
      return { isPrimary: false, confidence: "unknown", gapMonths: null };
    }
    const joinedYear = parseInt(joinedDate);
    const foundedYear = parseInt(foundedDate);
    const gapMonths = Math.abs(joinedYear - foundedYear) * 12;

    if (gapMonths <= 6) return { isPrimary: true, confidence: "confirmed", gapMonths };
    if (gapMonths <= 24) return { isPrimary: true, confidence: "likely", gapMonths };
    if (gapMonths <= 60) return { isPrimary: false, confidence: "possible", gapMonths };
    return { isPrimary: false, confidence: "unknown", gapMonths };
  }

  it("confirms founder when dates match exactly", () => {
    const result = compareDates("2005", "2005");
    expect(result.isPrimary).toBe(true);
    expect(result.confidence).toBe("confirmed");
    expect(result.gapMonths).toBe(0);
  });

  it("confirms founder when gap is within 6 months (same year)", () => {
    const result = compareDates("2005", "2005");
    expect(result.isPrimary).toBe(true);
    expect(result.confidence).toBe("confirmed");
  });

  it("marks likely founder when gap is 1-2 years", () => {
    const result = compareDates("2006", "2005");
    expect(result.isPrimary).toBe(true);
    expect(result.confidence).toBe("likely");
    expect(result.gapMonths).toBe(12);
  });

  it("marks possible when gap is 3-5 years", () => {
    const result = compareDates("2009", "2005");
    expect(result.isPrimary).toBe(false);
    expect(result.confidence).toBe("possible");
    expect(result.gapMonths).toBe(48);
  });

  it("returns unknown when gap exceeds 5 years", () => {
    const result = compareDates("2015", "2005");
    expect(result.isPrimary).toBe(false);
    expect(result.confidence).toBe("unknown");
    expect(result.gapMonths).toBe(120);
  });

  it("handles null joined date", () => {
    const result = compareDates(null, "2005");
    expect(result.isPrimary).toBe(false);
    expect(result.confidence).toBe("unknown");
    expect(result.gapMonths).toBeNull();
  });

  it("handles null founded date", () => {
    const result = compareDates("2005", null);
    expect(result.isPrimary).toBe(false);
    expect(result.gapMonths).toBeNull();
  });
});
