/**
 * Thrown when a metered API endpoint returns 402 Payment Required.
 * Carries the structured fields from the route's JSON response so the
 * UI can render the right paywall surface (UpgradeCard vs AnonSignupWall)
 * without re-parsing the response.
 */
export class UpgradeRequiredError extends Error {
  readonly errorCode:
    | "free_quota_exceeded"
    | "anon_quota_exceeded"
    | "free_chat_exceeded"
    | "anon_chat_blocked";
  readonly tier: "free" | "anon";
  readonly upgradeUrl: string;

  constructor(args: {
    errorCode: UpgradeRequiredError["errorCode"];
    tier: UpgradeRequiredError["tier"];
    upgradeUrl: string;
    message: string;
  }) {
    super(args.message);
    this.name = "UpgradeRequiredError";
    this.errorCode = args.errorCode;
    this.tier = args.tier;
    this.upgradeUrl = args.upgradeUrl;
  }
}
