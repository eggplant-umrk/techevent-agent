import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Server-side client. The key comes from .env via process.env and is never sent to the browser or logged. */
export function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY が .env にありません");
    client = new Anthropic({ apiKey });
  }
  return client;
}
