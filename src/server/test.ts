import type { HermesProfileRuntimeContext } from "./types.js";
import { parseHermesProfileConfig } from "./config.js";

export async function testHermesProfileEnvironment(ctx: HermesProfileRuntimeContext): Promise<unknown> {
  const config = parseHermesProfileConfig(ctx.config);
  return {
    ok: true,
    profile: config.profile,
    checks: ["config_parsed"],
    warnings: ["Environment smoke checks not implemented yet."],
  };
}
