import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type VercelCron = Readonly<{
  path: string;
  schedule: string;
}>;

const VERCEL_CRON_JOBS_PER_PROJECT_LIMIT = 100;

const config = JSON.parse(
  readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
) as { crons?: VercelCron[] };

function runsAtMostDaily(schedule: string): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour] = fields;
  return /^(?:[0-5]?\d)$/.test(minute) && /^(?:[01]?\d|2[0-3])$/.test(hour);
}

function isHobbyCronConfigurationCompatible(crons: VercelCron[]): boolean {
  return (
    crons.length <= VERCEL_CRON_JOBS_PER_PROJECT_LIMIT &&
    crons.every((cron) => runsAtMostDaily(cron.schedule))
  );
}

describe("Vercel Hobby deployment policy", () => {
  it("uses no more than Vercel's per-project cron-job allowance", () => {
    expect(config.crons ?? []).not.toHaveLength(0);
    expect((config.crons ?? []).length).toBeLessThanOrEqual(
      VERCEL_CRON_JOBS_PER_PROJECT_LIMIT,
    );
  });

  it.each([
    ["daily", "43 7 * * *", true],
    ["weekly", "17 7 * * 1", true],
    ["every five minutes", "*/5 * * * *", false],
    ["hourly", "0 * * * *", false],
    ["twice daily", "0 7,19 * * *", false],
  ])("classifies a %s schedule", (_description, schedule, expected) => {
    expect(runsAtMostDaily(schedule)).toBe(expected);
  });

  it("accepts a third daily cron job", () => {
    const dailyCrons = [
      "17 7 * * *",
      "43 7 * * *",
      "11 9 * * 1-5",
    ].map((schedule, index) => ({
      path: `/api/cron/daily-${index + 1}`,
      schedule,
    }));

    expect(dailyCrons).toHaveLength(3);
    expect(isHobbyCronConfigurationCompatible(dailyCrons)).toBe(true);
  });

  it("rejects a subdaily cron job", () => {
    const crons = [
      { path: "/api/cron/daily", schedule: "17 7 * * *" },
      { path: "/api/cron/subdaily", schedule: "*/5 * * * *" },
    ];

    expect(isHobbyCronConfigurationCompatible(crons)).toBe(false);
  });

  it("rejects more than 100 cron jobs", () => {
    const crons = Array.from({ length: 101 }, (_, index) => ({
      path: `/api/cron/daily-${index + 1}`,
      schedule: "17 7 * * *",
    }));

    expect(isHobbyCronConfigurationCompatible(crons)).toBe(false);
  });

  it("does not schedule any cron more than once per day", () => {
    expect(config.crons ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringMatching(/^\/api\//),
          schedule: expect.any(String),
        }),
      ]),
    );

    for (const cron of config.crons ?? []) {
      expect(runsAtMostDaily(cron.schedule), `${cron.path}: ${cron.schedule}`).toBe(
        true,
      );
    }
    expect(isHobbyCronConfigurationCompatible(config.crons ?? [])).toBe(true);
  });
});
