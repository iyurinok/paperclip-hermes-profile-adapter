import type { HermesProfileRuntimeContext } from "./types.js";
import { parseHermesProfileConfig } from "./config.js";

export async function listHermesProfileSkills(ctx: HermesProfileRuntimeContext): Promise<unknown> {
  const config = parseHermesProfileConfig(ctx.config);
  return {
    adapterType: "hermes_profile",
    supported: true,
    mode: "profile-readonly",
    entries: [],
    warnings: [`Skill listing scaffold for profile ${config.profile}; profile-local inventory not implemented yet.`],
  };
}

export async function syncHermesProfileSkills(ctx: HermesProfileRuntimeContext, desiredSkills: string[] = []): Promise<unknown> {
  const snapshot = await listHermesProfileSkills(ctx) as Record<string, unknown>;
  return {
    ...snapshot,
    desiredSkills,
    warnings: [...(Array.isArray(snapshot.warnings) ? snapshot.warnings : []), "syncSkills is intentionally read-only/no-op in initial scaffold."],
  };
}
