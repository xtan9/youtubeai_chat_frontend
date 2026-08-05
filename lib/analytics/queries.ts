import {
  ANALYTICS_SUBJECT_PROPERTY,
  ANALYTICS_SYNTHETIC_SUBJECT,
} from "./identity";

/**
 * Defense-in-depth filter for every canonical business query.
 *
 * The event-side clause excludes events that carry the marker directly. The
 * person-side clause is what removes anonymous events that were captured
 * before Auth resolved a Smoke Account and were subsequently merged into that
 * synthetic person by PostHog identify().
 */
export const BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER = [
  `coalesce(properties['${ANALYTICS_SUBJECT_PROPERTY}'], '') != '${ANALYTICS_SYNTHETIC_SUBJECT}'`,
  `coalesce(person.properties['${ANALYTICS_SUBJECT_PROPERTY}'], '') != '${ANALYTICS_SYNTHETIC_SUBJECT}'`,
].join(" AND ");

export const CANONICAL_BUSINESS_ANALYTICS_QUERY_NAMES = [
  "acquisition",
  "activation",
  "engagement",
  "retention",
  "conversion",
  "active_users",
] as const;

export type CanonicalBusinessAnalyticsQueryName =
  (typeof CANONICAL_BUSINESS_ANALYTICS_QUERY_NAMES)[number];

const EVENTS_BY_QUERY: Record<CanonicalBusinessAnalyticsQueryName, string[]> = {
  acquisition: ["$pageview", "summary_button_clicked", "hero_demo_sample_selected"],
  activation: ["signup_completed", "summary_succeeded"],
  engagement: ["summary_succeeded", "chat_started", "new_summary_button_clicked"],
  retention: ["summary_succeeded", "chat_started"],
  conversion: ["checkout_started", "subscription_activated"],
  active_users: [],
};

function quoteEventName(eventName: string): string {
  return `'${eventName.replaceAll("'", "''")}'`;
}

function eventClause(name: CanonicalBusinessAnalyticsQueryName): string {
  const events = EVENTS_BY_QUERY[name];
  return events.length
    ? `event IN (${events.map(quoteEventName).join(", ")}) AND `
    : "";
}

function buildCanonicalQuery(name: CanonicalBusinessAnalyticsQueryName): string {
  const count = name === "active_users" ? "count(DISTINCT distinct_id)" : "count()";
  return [
    `SELECT ${count} AS ${name}`,
    "FROM events",
    `WHERE ${eventClause(name)}${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
  ].join("\n");
}

export const CANONICAL_BUSINESS_ANALYTICS_QUERIES = Object.fromEntries(
  CANONICAL_BUSINESS_ANALYTICS_QUERY_NAMES.map((name) => [
    name,
    buildCanonicalQuery(name),
  ]),
) as Record<CanonicalBusinessAnalyticsQueryName, string>;

