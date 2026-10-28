export type ChatGatewayFailureCode =
  | "provider_configuration_missing"
  | "provider_http_error"
  | "provider_missing_body";

const messages: Record<ChatGatewayFailureCode, string> = {
  provider_configuration_missing: "LLM gateway URL and API key must be configured.",
  provider_http_error: "The LLM gateway returned an unsuccessful HTTP status.",
  provider_missing_body: "The LLM gateway returned no response body.",
};

/** Safe diagnostics only: never retain upstream response text or credentials. */
export class ChatGatewayError extends Error {
  readonly name = "ChatGatewayError";

  constructor(
    readonly failureCode: ChatGatewayFailureCode,
    readonly httpStatus?: number,
  ) {
    super(messages[failureCode]);
  }
}
