import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  capture: vi.fn(),
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("../server", () => ({
  captureProjectActivityEvent: mocks.capture,
  captureProjectActivityEventWithStatus: mocks.capture,
}));

import {
  drainProjectActivationOutbox,
  recordProjectAnalyticsTransition,
  recordProjectGenerationUsage,
} from "../project-server";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const OPERATION_ID = "b0000000-0000-4000-8000-000000000001";
const OWNER_ID = "c0000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "d0000000-0000-4000-8000-000000000001";

describe("Project server analytics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.capture.mockResolvedValue(undefined);
  });

  it("exports the authoritative activation revision and timestamp from the durable outbox", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "record_project_analytics_transition") {
        return {
          data: {
            outcome: "already_activated",
            activationKind: "search",
            readyVideos: 2,
          },
          error: null,
        };
      }
      if (name === "claim_project_activation_exports") {
        return {
          data: {
            outcome: "claimed",
            exports: [
              {
                projectId: PROJECT_ID,
                ownerId: OWNER_ID,
                activationRevision: 2,
                activationKind: "search",
                activatedAt: "2026-08-09T19:59:00.123Z",
                readyVideos: 2,
                leaseToken: LEASE_TOKEN,
              },
            ],
          },
          error: null,
        };
      }
      if (name === "ack_project_activation_export") {
        return { data: { outcome: "acknowledged" }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.capture.mockResolvedValue("sent");

    await recordProjectAnalyticsTransition({
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      trigger: "search",
      occurredAt: "2026-08-09T20:00:00.123Z",
      businessAnalyticsSuppressed: false,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_project_analytics_transition",
      expect.objectContaining({
        p_occurred_at: "2026-08-09T20:00:00.123Z",
      }),
    );

    expect(mocks.capture).toHaveBeenCalledWith(
      OWNER_ID,
      "project_activated",
      {
        project_id: PROJECT_ID,
        activation_kind: "search",
        activation_revision: 2,
        activation_occurred_at: "2026-08-09T19:59:00.123Z",
        ready_videos: 2,
      },
      false,
      `project-activation:${PROJECT_ID}:2`,
      "2026-08-09T19:59:00.123Z",
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "ack_project_activation_export",
      {
        p_project_id: PROJECT_ID,
        p_activation_revision: 2,
        p_lease_token: LEASE_TOKEN,
      },
    );
  });

  it("excludes smoke accounts before any durable or transport write", async () => {
    await recordProjectAnalyticsTransition({
      projectId: PROJECT_ID,
      ownerId: "smoke-owner",
      trigger: "message",
      occurredAt: "2026-08-09T20:00:00.123Z",
      businessAnalyticsSuppressed: true,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("replays a failed lease with the same privacy-safe dedupe marker", async () => {
    const activationExport = {
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      activationRevision: 2,
      activationKind: "search",
      activatedAt: "2026-08-09T19:59:00.123Z",
      readyVideos: 2,
      leaseToken: LEASE_TOKEN,
    } as const;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_project_activation_exports") {
        return {
          data: { outcome: "claimed", exports: [activationExport] },
          error: null,
        };
      }
      if (name === "ack_project_activation_export") {
        return { data: { outcome: "acknowledged" }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.capture
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("sent");

    await expect(drainProjectActivationOutbox(1)).resolves.toEqual({
      claimed: 1,
      sent: 0,
      pending: 1,
      unavailable: false,
    });
    await expect(drainProjectActivationOutbox(1)).resolves.toEqual({
      claimed: 1,
      sent: 1,
      pending: 0,
      unavailable: false,
    });

    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.capture.mock.calls[0]?.[4]).toBe(
      `project-activation:${PROJECT_ID}:2`,
    );
    expect(mocks.capture.mock.calls[1]?.[4]).toBe(
      mocks.capture.mock.calls[0]?.[4],
    );
    expect(mocks.rpc.mock.calls.filter(([name]) =>
      name === "ack_project_activation_export"
    )).toHaveLength(1);
  });

  it("fails soft when the durable activation writer is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockRejectedValue(new Error("database unavailable"));
    await expect(
      recordProjectAnalyticsTransition({
        projectId: PROJECT_ID,
        ownerId: "owner-1",
        trigger: "artifact",
        occurredAt: "2026-08-09T20:00:00.123Z",
        businessAnalyticsSuppressed: false,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("records explicit unavailable usage without estimated token fields", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "inserted" }, error: null });
    await recordProjectGenerationUsage({
      projectId: PROJECT_ID,
      ownerId: "owner-1",
      operationId: OPERATION_ID,
      generationKind: "grounded_answer",
      durationMs: 150,
      businessAnalyticsSuppressed: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_project_generation_usage",
      expect.objectContaining({
        p_cost_status: "unavailable",
        p_error_class: "usage_unavailable",
        p_input_tokens: null,
        p_cached_input_tokens: null,
        p_output_tokens: null,
        p_cost_usd_micros: null,
      }),
    );
  });

  it("surfaces an inactive Project outcome without sending cost analytics", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "inactive" }, error: null });

    await expect(
      recordProjectGenerationUsage({
        projectId: PROJECT_ID,
        ownerId: OWNER_ID,
        operationId: OPERATION_ID,
        generationKind: "grounded_answer",
        durationMs: 150,
        businessAnalyticsSuppressed: false,
      }),
    ).resolves.toBe("inactive");

    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("records the qualifying transition and first generation usage atomically", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "record_project_activated_generation_usage") {
        return { data: { outcome: "inserted" }, error: null };
      }
      if (name === "claim_project_activation_exports") {
        return { data: { outcome: "empty", exports: [] }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    await expect(
      recordProjectGenerationUsage({
        projectId: PROJECT_ID,
        ownerId: OWNER_ID,
        operationId: OPERATION_ID,
        generationKind: "grounded_answer",
        durationMs: 150,
        businessAnalyticsSuppressed: false,
        activation: {
          trigger: "message",
          occurredAt: "2026-08-09T20:00:00.123Z",
        },
      }),
    ).resolves.toBe("inserted");

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "record_project_activated_generation_usage",
      expect.objectContaining({
        p_trigger_kind: "message",
        p_occurred_at: "2026-08-09T20:00:00.123Z",
        p_operation_id: OPERATION_ID,
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "record_project_generation_usage",
      expect.anything(),
    );
  });

  it("uses only a complete, versioned configured rate card", async () => {
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_VERSION", "gateway-2026-08");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_SOURCE", "provider_contract");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_MODEL_ID", "gpt-5.3-codex-spark");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_GATEWAY_PROVIDER", "cliproxyapi");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_EFFECTIVE_DATE", "2026-08-01");
    vi.stubEnv("PROJECT_MODEL_INPUT_USD_PER_MILLION_TOKENS", "2");
    vi.stubEnv("PROJECT_MODEL_CACHED_INPUT_USD_PER_MILLION_TOKENS", "0.5");
    vi.stubEnv("PROJECT_MODEL_OUTPUT_USD_PER_MILLION_TOKENS", "8");
    mocks.rpc.mockResolvedValue({ data: { outcome: "inserted" }, error: null });

    await recordProjectGenerationUsage({
      projectId: PROJECT_ID,
      ownerId: "owner-1",
      operationId: OPERATION_ID,
      generationKind: "study_guide",
      usage: { inputTokens: 100, cachedInputTokens: 25, outputTokens: 50 },
      durationMs: 250,
      businessAnalyticsSuppressed: false,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_project_generation_usage",
      expect.objectContaining({
        p_model_id: "gpt-5.3-codex-spark",
        p_provider_kind: "cliproxyapi",
        p_cost_status: "measured",
        p_cost_usd_micros: 563,
        p_rate_card_version: "gateway-2026-08",
        p_rate_card_source: "provider_contract",
        p_rate_card_effective_date: "2026-08-01",
      }),
    );
  });

  it.each([
    ["PROJECT_MODEL_RATE_CARD_MODEL_ID", "different-model"],
    ["PROJECT_MODEL_RATE_CARD_GATEWAY_PROVIDER", "different-gateway"],
    ["PROJECT_MODEL_RATE_CARD_SOURCE", "openai_official"],
  ])("marks usage unavailable when %s does not match the billed contract", async (field, value) => {
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_VERSION", "gateway-2026-08");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_SOURCE", "provider_contract");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_MODEL_ID", "gpt-5.3-codex-spark");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_GATEWAY_PROVIDER", "cliproxyapi");
    vi.stubEnv("PROJECT_MODEL_RATE_CARD_EFFECTIVE_DATE", "2026-08-01");
    vi.stubEnv("PROJECT_MODEL_INPUT_USD_PER_MILLION_TOKENS", "2");
    vi.stubEnv("PROJECT_MODEL_CACHED_INPUT_USD_PER_MILLION_TOKENS", "0.5");
    vi.stubEnv("PROJECT_MODEL_OUTPUT_USD_PER_MILLION_TOKENS", "8");
    vi.stubEnv(field, value);
    mocks.rpc.mockResolvedValue({ data: { outcome: "inserted" }, error: null });

    await recordProjectGenerationUsage({
      projectId: PROJECT_ID,
      ownerId: "owner-1",
      operationId: OPERATION_ID,
      generationKind: "study_guide",
      usage: { inputTokens: 100, cachedInputTokens: 25, outputTokens: 50 },
      durationMs: 250,
      businessAnalyticsSuppressed: false,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_project_generation_usage",
      expect.objectContaining({
        p_cost_status: "unavailable",
        p_error_class: "rate_card_unavailable",
        p_cost_usd_micros: null,
      }),
    );
  });
});
