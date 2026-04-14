import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSuppressionTable,
  isEmailSuppressed,
  addToSuppressionList,
  bulkCheckSuppression,
  getSuppressionList,
  removeFromSuppressionList,
} from "@/lib/suppression";

function freshDb() {
  const db = new Database(":memory:");
  createSuppressionTable(db);
  return db;
}

describe("suppression list", () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it("returns false for email not in list", () => {
    expect(isEmailSuppressed(db, "clean@example.com")).toBe(false);
  });

  it("returns true after adding email", () => {
    addToSuppressionList(db, "bad@example.com", "unsubscribed", "manual");
    expect(isEmailSuppressed(db, "bad@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    addToSuppressionList(db, "Bad@Example.COM", "bounced", "instantly_sync");
    expect(isEmailSuppressed(db, "bad@example.com")).toBe(true);
  });

  it("bulk checks multiple emails", () => {
    addToSuppressionList(db, "blocked@test.com", "complained", "manual");
    const result = bulkCheckSuppression(db, ["clean@test.com", "blocked@test.com", "also-clean@test.com"]);
    expect(result).toEqual(new Set(["blocked@test.com"]));
  });

  it("lists all suppressed entries", () => {
    addToSuppressionList(db, "a@test.com", "unsubscribed", "manual");
    addToSuppressionList(db, "b@test.com", "bounced", "instantly_sync");
    const list = getSuppressionList(db);
    expect(list).toHaveLength(2);
    expect(list[0].email).toBe("a@test.com");
  });

  it("removes an email from the list", () => {
    addToSuppressionList(db, "removeme@test.com", "manual", "manual");
    removeFromSuppressionList(db, "removeme@test.com");
    expect(isEmailSuppressed(db, "removeme@test.com")).toBe(false);
  });

  it("does not duplicate on re-add", () => {
    addToSuppressionList(db, "dupe@test.com", "bounced", "instantly_sync");
    addToSuppressionList(db, "dupe@test.com", "unsubscribed", "manual");
    const list = getSuppressionList(db);
    const dupes = list.filter((e) => e.email === "dupe@test.com");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].reason).toBe("unsubscribed");
  });
});
