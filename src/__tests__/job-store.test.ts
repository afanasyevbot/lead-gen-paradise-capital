import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { JobStore } from "@/infrastructure/jobs/store";

describe("JobStore", () => {
  let db: Database.Database;
  let store: JobStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new JobStore(db);
  });

  it("creates a job with running status", () => {
    const job = store.create("pipeline");
    expect(job.id).toMatch(/^pipeline-/);
    expect(job.status).toBe("running");
    expect(job.type).toBe("pipeline");
    expect(job.progress.stage).toBe("starting");
  });

  it("get returns created job", () => {
    const created = store.create("scrape");
    const fetched = store.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.type).toBe("scrape");
  });

  it("get returns null for missing job", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("updateProgress merges with existing progress", () => {
    const job = store.create("pipeline");
    store.updateProgress(job.id, { stage: "Scraping", current: 1, total: 6 });
    const updated = store.get(job.id);
    expect(updated!.progress.stage).toBe("Scraping");
    expect(updated!.progress.current).toBe(1);
    expect(updated!.progress.total).toBe(6);
    expect(updated!.progress.currentItem).toBe(""); // preserved from initial
  });

  it("complete marks job as completed with results", () => {
    const job = store.create("pipeline");
    store.complete(job.id, { scraped: 5, enriched: 3 });
    const completed = store.get(job.id);
    expect(completed!.status).toBe("completed");
    expect(completed!.result).toEqual({ scraped: 5, enriched: 3 });
    expect(completed!.completedAt).toBeDefined();
  });

  it("fail marks job as failed with error", () => {
    const job = store.create("pipeline");
    store.fail(job.id, "API rate limited");
    const failed = store.get(job.id);
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toBe("API rate limited");
    expect(failed!.completedAt).toBeDefined();
  });

  it("getRecent returns jobs in reverse chronological order", () => {
    store.create("pipeline");
    store.create("scrape");
    store.create("pipeline");
    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    // Most recent first
    expect(recent[0].type).toBe("pipeline");
  });

  it("cleanup removes old completed jobs", () => {
    const job = store.create("pipeline");
    // Manually set completed_at to the past
    db.prepare(
      "UPDATE jobs SET status = 'completed', completed_at = datetime('now', '-48 hours') WHERE id = ?"
    ).run(job.id);

    const deleted = store.cleanup(24);
    expect(deleted).toBe(1);
    expect(store.get(job.id)).toBeNull();
  });

  it("cleanup does not remove running jobs", () => {
    const job = store.create("pipeline");
    const deleted = store.cleanup(0); // even with 0 hours, running jobs have no completed_at
    expect(deleted).toBe(0);
    expect(store.get(job.id)).not.toBeNull();
  });

  it("multiple job lifecycle", () => {
    const j1 = store.create("pipeline");
    const j2 = store.create("scrape");

    store.updateProgress(j1.id, { stage: "Extracting", current: 3, total: 6 });
    store.complete(j2.id, { scraped: 10 });
    store.fail(j1.id, "Claude 529");

    expect(store.get(j1.id)!.status).toBe("failed");
    expect(store.get(j2.id)!.status).toBe("completed");
    expect(store.getRecent()).toHaveLength(2);
  });
});
