import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getServiceRoleClient: vi.fn(),
    generateSemanticProfile: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("../semantic-profile", () => ({
  generateSemanticProfile: mocks.generateSemanticProfile,
}));

import { runSemanticProfileWorker } from "../semantic-profile-worker";

const WORK = {
  msg_id: 71,
  read_count: 1,
  request_id: "10000000-0000-4000-8000-000000000001",
  video_id: "20000000-0000-4000-8000-000000000002",
  title: "Gradient descent",
  source_language: "en",
  transcript: "Gradient descent updates parameters using a loss gradient.",
  content_fingerprint: "a".repeat(64),
  profile_schema_version: "semantic-profile-v1",
};

const PROFILE = {
  schemaVersion: "semantic-profile-v1",
  sourceLanguage: "en",
  topics: [{ key: "machine-learning", label: "Machine learning" }],
  coreConcepts: [
    { key: "gradient-descent", label: "Gradient descent" },
    { key: "loss-function", label: "Loss function" },
  ],
  difficulty: "intermediate",
  prerequisiteConceptKeys: ["calculus"],
  applicationConceptKeys: ["model-training"],
  counterpointConceptKeys: ["gradient-free-optimization"],
} as const;

describe("runSemanticProfileWorker", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.generateSemanticProfile.mockReset();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_semantic_profile_work") {
        return { data: [WORK], error: null };
      }
      if (name === "begin_semantic_profile_generation") {
        return { data: { outcome: "started" }, error: null };
      }
      return { data: { outcome: "completed" }, error: null };
    });
    mocks.generateSemanticProfile.mockResolvedValue(PROFILE);
  });

  it("claims bounded asynchronous work, reserves budget, and persists only validated profile fields", async () => {
    await expect(runSemanticProfileWorker()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deferred: 0,
      obsolete: 0,
      retried: 0,
      exhausted: 0,
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "claim_semantic_profile_work", {
      p_batch_size: 4,
      p_visibility_timeout_seconds: 120,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("begin_semantic_profile_generation", {
      p_request_id: WORK.request_id,
      p_estimated_micro_usd: 5_000,
    });
    expect(mocks.generateSemanticProfile).toHaveBeenCalledWith({
      title: WORK.title,
      sourceLanguage: WORK.source_language,
      transcript: WORK.transcript,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_semantic_profile_work",
      expect.objectContaining({
        p_msg_id: WORK.msg_id,
        p_request_id: WORK.request_id,
        p_content_fingerprint: WORK.content_fingerprint,
        p_profile: PROFILE,
        p_topic_keys: ["machine-learning"],
        p_core_concept_keys: ["gradient-descent", "loss-function"],
        p_difficulty: "intermediate",
      }),
    );
  });

  it("does not call the Gateway when the durable processing budget is exhausted", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_semantic_profile_work") {
        return { data: [WORK], error: null };
      }
      if (name === "begin_semantic_profile_generation") {
        return { data: { outcome: "budget_exhausted" }, error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });

    await expect(runSemanticProfileWorker()).resolves.toMatchObject({
      claimed: 1,
      deferred: 1,
      completed: 0,
      obsolete: 0,
    });

    expect(mocks.generateSemanticProfile).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("defer_semantic_profile_work", {
      p_msg_id: WORK.msg_id,
      p_request_id: WORK.request_id,
      p_delay_seconds: 900,
    });
  });

  it("routes invalid Gateway output through bounded retry without persistence", async () => {
    mocks.generateSemanticProfile.mockRejectedValue(new Error("schema mismatch"));

    await expect(runSemanticProfileWorker()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      obsolete: 0,
      retried: 1,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_semantic_profile_work",
      expect.objectContaining({
        p_msg_id: WORK.msg_id,
        p_request_id: WORK.request_id,
        p_failure_code: "gateway_or_schema",
        p_max_attempts: 4,
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_semantic_profile_work",
      expect.anything(),
    );
  });

  it("does not acknowledge an unknown budget outcome as obsolete", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_semantic_profile_work") {
        return { data: [WORK], error: null };
      }
      if (name === "begin_semantic_profile_generation") {
        return { data: { outcome: "unexpected" }, error: null };
      }
      if (name === "fail_semantic_profile_work") {
        return { data: { outcome: "retry" }, error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });

    await expect(runSemanticProfileWorker()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      obsolete: 0,
      retried: 1,
    });
    expect(mocks.generateSemanticProfile).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_semantic_profile_work",
      expect.objectContaining({
        p_request_id: WORK.request_id,
        p_failure_code: "worker_error",
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "ack_semantic_profile_work",
      expect.anything(),
    );
  });

  it("quarantines a claimed envelope without a trustworthy request id", async () => {
    const malformed = { ...WORK, request_id: null };
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_semantic_profile_work") {
        return { data: [malformed], error: null };
      }
      if (name === "fail_semantic_profile_work") {
        return { data: { outcome: "exhausted" }, error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });

    await expect(runSemanticProfileWorker()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      obsolete: 0,
      exhausted: 1,
    });
    expect(mocks.generateSemanticProfile).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_semantic_profile_work",
      expect.objectContaining({ p_request_id: null }),
    );
  });

  it("routes an identifiable malformed envelope through the bounded retry RPC", async () => {
    const malformed = { ...WORK, title: "" };
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_semantic_profile_work") {
        return { data: [malformed], error: null };
      }
      if (name === "fail_semantic_profile_work") {
        return { data: { outcome: "retry" }, error: null };
      }
      return { data: { outcome: "completed" }, error: null };
    });

    await expect(runSemanticProfileWorker()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      retried: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_semantic_profile_work",
      expect.objectContaining({
        p_request_id: WORK.request_id,
        p_failure_code: "invalid_message",
      }),
    );
  });
});
