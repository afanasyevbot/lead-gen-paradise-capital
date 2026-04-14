import { describe, it, expect } from "vitest";

// ─── CSV Parser (replicated from upload/route.ts for unit testing) ───────────
// These functions mirror the upload route's CSV parser to test parsing logic
// independently of the API route.

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

// ─── Column Mapping (replicated from upload/route.ts) ────────────────────────

const COLUMN_MAP: Record<string, string> = {
  "Company": "business_name",
  "Company Name": "business_name",
  "company": "business_name",
  "Company City": "city",
  "Company State": "state",
  "Company Phone": "phone",
  "Website": "website",
  "Company Website": "website",
  "# Employees": "employees",
  "Email": "email",
  "First Name": "first_name",
  "Last Name": "last_name",
  "Title": "title",
  "City": "city",
  "State": "state",
  "business_name": "business_name",
  "Business Name": "business_name",
  "website": "website",
  "phone": "phone",
  "city": "city",
  "state": "state",
  "email": "email",
};

function mapRow(row: Record<string, string>) {
  const mapped: Record<string, string> = {};
  for (const [csvCol, value] of Object.entries(row)) {
    const key = COLUMN_MAP[csvCol];
    if (key && value) {
      mapped[key] = value;
    }
  }

  const contactInfo: { email?: string; firstName?: string; lastName?: string; title?: string } = {};
  if (mapped.email) contactInfo.email = mapped.email;
  if (mapped.first_name) contactInfo.firstName = mapped.first_name;
  if (mapped.last_name) contactInfo.lastName = mapped.last_name;
  if (mapped.title) contactInfo.title = mapped.title;

  const businessName = mapped.business_name || "Unknown Business";

  return {
    lead: {
      business_name: businessName,
      city: mapped.city || null,
      state: mapped.state || null,
      phone: mapped.phone || null,
      website: mapped.website || null,
    },
    contactInfo,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseCSVLine", () => {
  it("parses simple comma-separated values", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCSVLine('"hello, world",b,c')).toEqual(["hello, world", "b", "c"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCSVLine('"He said ""hello""",b')).toEqual(['He said "hello"', "b"]);
  });

  it("handles empty fields", () => {
    expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles single value", () => {
    expect(parseCSVLine("hello")).toEqual(["hello"]);
  });

  it("handles empty string", () => {
    expect(parseCSVLine("")).toEqual([""]);
  });

  it("handles trailing comma", () => {
    expect(parseCSVLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("handles quoted fields with newlines (within a single CSV line)", () => {
    // Note: in real CSV, newlines in quoted fields span multiple lines
    // but our line-by-line parser won't see this case
    expect(parseCSVLine('"no newline",b')).toEqual(["no newline", "b"]);
  });
});

describe("parseCSV", () => {
  it("parses a simple CSV with headers", () => {
    const csv = "Name,City,State\nJoe's Plumbing,Tampa,FL\nBob's HVAC,Miami,FL";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "Joe's Plumbing", City: "Tampa", State: "FL" });
    expect(rows[1]).toEqual({ Name: "Bob's HVAC", City: "Miami", State: "FL" });
  });

  it("handles Windows-style line endings (\\r\\n)", () => {
    const csv = "Name,City\r\nTest Co,Tampa\r\n";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Name).toBe("Test Co");
  });

  it("returns empty array for header-only CSV", () => {
    expect(parseCSV("Name,City")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("skips empty lines", () => {
    const csv = "Name,City\n\nJoe,Tampa\n\n";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
  });

  it("trims whitespace from values", () => {
    const csv = "Name,City\n  Joe's Shop  ,  Tampa  ";
    const rows = parseCSV(csv);
    expect(rows[0].Name).toBe("Joe's Shop");
    expect(rows[0].City).toBe("Tampa");
  });

  it("handles quoted fields with commas in values", () => {
    const csv = 'Company,Address\n"Smith, Jones & Co","123 Main St, Suite 4"';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Company).toBe("Smith, Jones & Co");
    expect(rows[0].Address).toBe("123 Main St, Suite 4");
  });

  it("handles missing columns gracefully", () => {
    const csv = "A,B,C\n1,2";
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "" });
  });
});

describe("Apollo CSV Column Mapping", () => {
  it("maps Apollo-style columns correctly", () => {
    const row = {
      "Company": "Tampa Marina LLC",
      "Company City": "Tampa",
      "Company State": "FL",
      "Company Phone": "(813) 555-1234",
      "Website": "https://tampamarina.com",
      "Email": "john@tampamarina.com",
      "First Name": "John",
      "Last Name": "Smith",
      "Title": "Owner",
      "# Employees": "25",
    };
    const { lead, contactInfo } = mapRow(row);
    expect(lead.business_name).toBe("Tampa Marina LLC");
    expect(lead.city).toBe("Tampa");
    expect(lead.state).toBe("FL");
    expect(lead.phone).toBe("(813) 555-1234");
    expect(lead.website).toBe("https://tampamarina.com");
    expect(contactInfo.email).toBe("john@tampamarina.com");
    expect(contactInfo.firstName).toBe("John");
    expect(contactInfo.lastName).toBe("Smith");
    expect(contactInfo.title).toBe("Owner");
  });

  it("maps generic CSV columns correctly", () => {
    const row = {
      "Business Name": "Gulf Coast HVAC",
      "city": "St. Petersburg",
      "state": "FL",
      "phone": "(727) 555-9876",
      "website": "https://gulfcoasthvac.com",
      "email": "info@gulfcoasthvac.com",
    };
    const { lead, contactInfo } = mapRow(row);
    expect(lead.business_name).toBe("Gulf Coast HVAC");
    expect(lead.city).toBe("St. Petersburg");
    expect(contactInfo.email).toBe("info@gulfcoasthvac.com");
  });

  it("handles row with no mapped columns", () => {
    const row = {
      "UnknownCol1": "value1",
      "Random": "value2",
    };
    const { lead } = mapRow(row);
    expect(lead.business_name).toBe("Unknown Business");
    expect(lead.city).toBeNull();
  });

  it("handles row with only business name", () => {
    const row = { "Company": "Solo Business" };
    const { lead, contactInfo } = mapRow(row);
    expect(lead.business_name).toBe("Solo Business");
    expect(lead.website).toBeNull();
    expect(contactInfo.email).toBeUndefined();
  });

  it("handles empty values in mapped columns", () => {
    const row = {
      "Company": "Test Co",
      "Email": "",
      "City": "",
    };
    const { lead, contactInfo } = mapRow(row);
    expect(lead.business_name).toBe("Test Co");
    expect(lead.city).toBeNull();
    expect(contactInfo.email).toBeUndefined();
  });
});

describe("Full CSV-to-leads parsing", () => {
  it("parses a complete Apollo-like CSV export", () => {
    const csv = [
      "Company,Company City,Company State,Email,First Name,Last Name,Title,Website",
      "Marina One,Tampa,FL,john@marina1.com,John,Doe,Owner,https://marina1.com",
      "HVAC Pro,Miami,FL,jane@hvacpro.com,Jane,Smith,CEO,https://hvacpro.com",
    ].join("\n");

    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);

    const mapped = rows.map(mapRow);
    expect(mapped[0].lead.business_name).toBe("Marina One");
    expect(mapped[0].contactInfo.email).toBe("john@marina1.com");
    expect(mapped[1].lead.business_name).toBe("HVAC Pro");
    expect(mapped[1].lead.state).toBe("FL");
  });

  it("handles CSV with quoted business names containing commas", () => {
    const csv = [
      "Company,City,State",
      '"Smith, Jones & Associates",Orlando,FL',
      '"Bob\'s ""Best"" Plumbing",Tampa,FL',
    ].join("\n");

    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);

    const mapped1 = mapRow(rows[0]);
    expect(mapped1.lead.business_name).toBe("Smith, Jones & Associates");

    const mapped2 = mapRow(rows[1]);
    expect(mapped2.lead.business_name).toBe('Bob\'s "Best" Plumbing');
  });
});
