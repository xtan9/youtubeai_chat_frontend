import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockCreateClient, mockGetUser } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

import {
  resolveRequestPrincipal,
  type RequestPrincipalSource,
} from "../request-principal";

const DEFAULT_SOURCE: RequestPrincipalSource = "summary_stream";

const registeredUser = {
  id: "user-123",
  email: "  Person@Example.COM  ",
  is_anonymous: false,
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { display_name: "Person" },
};

function configureClient() {
  const client = { auth: { getUser: mockGetUser } };
  mockCreateClient.mockResolvedValue(client);
  return client;
}

function unavailableLogCall() {
  return vi.mocked(console.error).mock.calls;
}

describe("resolveRequestPrincipal", () => {
  beforeEach(() => {
    mockCreateClient.mockReset();
    mockGetUser.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a registered provider user through a narrow principal", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({ data: { user: registeredUser }, error: null });

    const result = await resolveRequestPrincipal({ source: DEFAULT_SOURCE });

    expect(result).toEqual({
      kind: "resolved",
      principal: {
        userId: "user-123",
        isAnonymous: false,
        email: "  Person@Example.COM  ",
        smokeProEntitled: false,
        businessAnalyticsSuppressed: false,
        projectAvailability: "unavailable",
      },
    });
    expect(Object.keys(result)).toEqual(["kind", "principal"]);
    if (result.kind !== "resolved") throw new Error("expected resolved result");
    expect(Object.keys(result.principal)).toEqual([
      "userId",
      "isAnonymous",
      "email",
      "smokeProEntitled",
      "businessAnalyticsSuppressed",
      "projectAvailability",
    ]);
  });

  it("marks an explicit provider anonymous user anonymous", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...registeredUser,
          id: "anon-123",
          email: "",
          is_anonymous: true,
        },
      },
      error: null,
    });

    await expect(
      resolveRequestPrincipal({ source: "chat_stream" }),
    ).resolves.toEqual({
      kind: "resolved",
      principal: {
        userId: "anon-123",
        isAnonymous: true,
        email: "",
        smokeProEntitled: false,
        businessAnalyticsSuppressed: false,
        projectAvailability: "unavailable",
      },
    });
  });

  it("treats an absent provider anonymous flag as registered", async () => {
    configureClient();
    const userWithoutFlag = Object.fromEntries(
      Object.entries(registeredUser).filter(([key]) => key !== "is_anonymous"),
    );
    mockGetUser.mockResolvedValue({
      data: { user: userWithoutFlag },
      error: null,
    });

    await expect(
      resolveRequestPrincipal({ source: DEFAULT_SOURCE }),
    ).resolves.toEqual({
      kind: "resolved",
      principal: {
        userId: "user-123",
        isAnonymous: false,
        email: "  Person@Example.COM  ",
        smokeProEntitled: false,
        businessAnalyticsSuppressed: false,
        projectAvailability: "unavailable",
      },
    });
  });

  it("preserves a missing provider email as null", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-no-email",
          is_anonymous: false,
        },
      },
      error: null,
    });

    await expect(
      resolveRequestPrincipal({ source: "account" }),
    ).resolves.toEqual({
      kind: "resolved",
      principal: {
        userId: "user-no-email",
        isAnonymous: false,
        email: null,
        smokeProEntitled: false,
        businessAnalyticsSuppressed: false,
        projectAvailability: "unavailable",
      },
    });
  });

  it("derives the smoke Pro entitlement only from trusted app metadata", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...registeredUser,
          app_metadata: {
            is_smoke_account: true,
            smoke_entitlement: "pro",
          },
          user_metadata: {
            is_smoke_account: false,
            smoke_entitlement: "free",
          },
        },
      },
      error: null,
    });

    const result = await resolveRequestPrincipal({ source: DEFAULT_SOURCE });

    expect(result).toMatchObject({
      kind: "resolved",
      principal: {
        smokeProEntitled: true,
        businessAnalyticsSuppressed: true,
        projectAvailability: "internal",
      },
    });
  });

  it("accepts only trusted Project beta metadata", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...registeredUser,
          app_metadata: { project_beta_access: "invited" },
          user_metadata: { project_beta_access: "internal" },
        },
      },
      error: null,
    });

    await expect(
      resolveRequestPrincipal({ source: "workspace_projects" }),
    ).resolves.toMatchObject({
      kind: "resolved",
      principal: { projectAvailability: "invited" },
    });
  });

  it("returns missing when the provider returns no user and no error", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(
      resolveRequestPrincipal({ source: DEFAULT_SOURCE }),
    ).resolves.toEqual({ kind: "missing" });
    expect(unavailableLogCall()).toHaveLength(0);
  });

  it.each([400, 401, 403])(
    "classifies provider status %s as missing without an outage event",
    async (status) => {
      configureClient();
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: {
          status,
          code: "AUTH_PROVIDER_DETAIL",
          message: "provider message must not cross the boundary",
        },
      });

      await expect(
        resolveRequestPrincipal({ source: "billing_checkout" }),
      ).resolves.toEqual({ kind: "missing" });
      expect(unavailableLogCall()).toHaveLength(0);
    },
  );

  it.each([408, 429, 500, 502, 503])(
    "classifies provider status %s as unavailable and emits one safe event",
    async (status) => {
      configureClient();
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: {
          status,
          code: "AUTH_PROVIDER_DETAIL",
          message: "provider message must not cross the boundary",
        },
      });

      await expect(
        resolveRequestPrincipal({
          source: "billing_portal",
          requestId: "req-193-example",
        }),
      ).resolves.toEqual({ kind: "unavailable" });

      expect(unavailableLogCall()).toEqual([
        [
          "REQUEST_PRINCIPAL_UNAVAILABLE",
          {
            source: "billing_portal",
            phase: "returned_error",
            status,
            requestId: "req-193-example",
          },
        ],
      ]);
      expect(JSON.stringify(unavailableLogCall())).not.toContain(
        "provider message",
      );
      expect(JSON.stringify(unavailableLogCall())).not.toContain(
        "AUTH_PROVIDER_DETAIL",
      );
    },
  );

  it("classifies an unknown error without exposing its details", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: "PRIVATE_AUTH_CODE",
        message: "private provider message",
      },
    });

    await expect(
      resolveRequestPrincipal({ source: "entitlements" }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(unavailableLogCall()).toEqual([
      [
        "REQUEST_PRINCIPAL_UNAVAILABLE",
        { source: "entitlements", phase: "returned_error" },
      ],
    ]);
    expect(JSON.stringify(unavailableLogCall())).not.toContain(
      "PRIVATE_AUTH_CODE",
    );
    expect(JSON.stringify(unavailableLogCall())).not.toContain(
      "private provider message",
    );
  });

  it("classifies a status-less thrown lookup as unavailable", async () => {
    configureClient();
    mockGetUser.mockRejectedValue(
      new Error("raw network failure must not be logged"),
    );

    await expect(
      resolveRequestPrincipal({ source: "chat_messages" }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(unavailableLogCall()).toEqual([
      [
        "REQUEST_PRINCIPAL_UNAVAILABLE",
        { source: "chat_messages", phase: "lookup_thrown" },
      ],
    ]);
    expect(JSON.stringify(unavailableLogCall())).not.toContain(
      "raw network failure",
    );
  });

  it("classifies a client creation failure as unavailable", async () => {
    mockCreateClient.mockRejectedValue(
      new Error("raw client setup failure must not be logged"),
    );

    await expect(
      resolveRequestPrincipal({ source: "admin_gate" }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(unavailableLogCall()).toEqual([
      [
        "REQUEST_PRINCIPAL_UNAVAILABLE",
        { source: "admin_gate", phase: "client_creation" },
      ],
    ]);
    expect(JSON.stringify(unavailableLogCall())).not.toContain(
      "raw client setup failure",
    );
  });

  it("gives a returned missing error precedence over a contradictory user", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: { user: registeredUser },
      error: { status: 401, code: "SESSION_INVALID", message: "invalid" },
    });

    await expect(
      resolveRequestPrincipal({ source: "summary_stream" }),
    ).resolves.toEqual({ kind: "missing" });
    expect(unavailableLogCall()).toHaveLength(0);
  });

  it("gives a returned unavailable error precedence over a contradictory user", async () => {
    configureClient();
    mockGetUser.mockResolvedValue({
      data: { user: registeredUser },
      error: { status: 503, code: "UPSTREAM_DOWN", message: "down" },
    });

    await expect(
      resolveRequestPrincipal({ source: "chat_suggestions" }),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(unavailableLogCall()).toEqual([
      [
        "REQUEST_PRINCIPAL_UNAVAILABLE",
        { source: "chat_suggestions", phase: "returned_error", status: 503 },
      ],
    ]);
    expect(JSON.stringify(unavailableLogCall())).not.toContain("user-123");
  });

  it("performs one fresh client and provider lookup for each resolution", async () => {
    const firstClient = configureClient();
    const secondClient = { auth: { getUser: mockGetUser } };
    mockCreateClient.mockResolvedValueOnce(firstClient).mockResolvedValueOnce(
      secondClient,
    );
    mockGetUser
      .mockResolvedValueOnce({ data: { user: registeredUser }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: null });

    await resolveRequestPrincipal({ source: DEFAULT_SOURCE });
    await resolveRequestPrincipal({ source: DEFAULT_SOURCE });

    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  it("accepts only the approved source identifiers at the public seam", async () => {
    const sources: RequestPrincipalSource[] = [
      "summary_stream",
      "chat_stream",
      "chat_messages",
      "chat_suggestions",
      "entitlements",
      "billing_checkout",
      "billing_portal",
      "admin_gate",
      "account",
      "workspace_projects",
      "project",
    ];

    for (const source of sources) {
      configureClient();
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: { status: 503 },
      });

      await resolveRequestPrincipal({ source });
    }

    expect(unavailableLogCall()).toHaveLength(sources.length);
    expect(unavailableLogCall().map(([, fields]) => fields)).toEqual(
      sources.map((source) => ({
        source,
        phase: "returned_error",
        status: 503,
      })),
    );
  });
});
