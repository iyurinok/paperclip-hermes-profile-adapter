import type { HermesProfileRuntimeContext } from "./types.js";
import { parseHermesProfileConfig } from "./config.js";

export async function executeHermesProfile(ctx: HermesProfileRuntimeContext, input?: unknown): Promise<unknown> {
  const config = parseHermesProfileConfig(ctx.config);
  // Placeholder until Paperclip adapter execute signature is verified.
  return {
    supported: false,
    mode: "draft",
    profile: config.profile,
    message: "executeHermesProfile scaffold: Paperclip execute signature not implemented yet",
    inputType: typeof input,
  };
}
