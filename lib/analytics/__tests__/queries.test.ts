import { describe, expect, it } from "vitest";
import {
  ANALYTICS_SUBJECT_PROPERTY,
  ANALYTICS_SYNTHETIC_SUBJECT,
} from "../identity";
import {
  BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER,
  CANONICAL_BUSINESS_ANALYTICS_QUERY_NAMES,
  CANONICAL_BUSINESS_ANALYTICS_QUERIES,
} from "../queries";

describe("canonical business analytics queries", () => {
  it("filters both event and person properties for the durable synthetic marker", () => {
    expect(BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER).toContain(
      `properties['${ANALYTICS_SUBJECT_PROPERTY}']`,
    );
    expect(BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER).toContain(
      `person.properties['${ANALYTICS_SUBJECT_PROPERTY}']`,
    );
    expect(BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER).toContain(
      ANALYTICS_SYNTHETIC_SUBJECT,
    );
  });

  it.each(CANONICAL_BUSINESS_ANALYTICS_QUERY_NAMES)(
    "applies the smoke exclusion to %s",
    (name) => {
      expect(CANONICAL_BUSINESS_ANALYTICS_QUERIES[name]).toContain(
        BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER,
      );
    },
  );
});
