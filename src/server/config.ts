import type { HermesProfileAdapterConfig } from "./types.js";

const PROFILE_RE = /^[a-z][a-z0-9_-]{1,31}$/;

export function parseHermesProfileConfig(raw: unknown): HermesProfileAdapterConfig {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const profile = value.profile;
  if (typeof profile !== "string" || !PROFILE_RE.test(profile)) {
    throw new Error("Invalid hermes_profile adapterConfig.profile");
  }
  const allowedProfiles = Array.isArray(value.allowedProfiles)
    ? value.allowedProfiles.filter((item): item is string => typeof item === "string")
    : undefined;
  if (allowedProfiles && !allowedProfiles.includes(profile)) {
    throw new Error(`Profile ${profile} is not allowlisted for hermes_profile`);
  }
  return {
    profile,
    timeoutSec: typeof value.timeoutSec === "number" ? value.timeoutSec : 300,
    persistSession: typeof value.persistSession === "boolean" ? value.persistSession : true,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    allowedProfiles,
  };
}
