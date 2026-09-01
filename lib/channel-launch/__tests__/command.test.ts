import { describe, expect, it } from "vitest";

import { verifyChannelLaunchPacketFile } from "../command";

describe("Channel launch packet verification command seam", () => {
  it("reports the checked-in packet as blocked without throwing", async () => {
    const result = await verifyChannelLaunchPacketFile(
      "docs/compliance/channel-production-launch-packet.json",
    );

    expect(result).toMatchObject({
      status: "blocked",
      decision: "blocked",
      releaseReviewEligible: false,
    });
  });

  it("fails closed when the packet input cannot be read", async () => {
    const result = await verifyChannelLaunchPacketFile(
      "docs/compliance/does-not-exist/channel-production-launch-packet.json",
    );

    expect(result).toMatchObject({
      status: "blocked",
      decision: "blocked",
      releaseReviewEligible: false,
      failures: [
        expect.objectContaining({ code: "packet_input_unavailable" }),
      ],
    });
  });
});
