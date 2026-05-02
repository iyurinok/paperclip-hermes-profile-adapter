import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { parseHermesProfileConfig, profileHome, profileWrapperPath } from "./config.js";
import type { HermesProfileEnvironmentContext } from "./types.js";

type Check = { code: string; level: "info" | "warn" | "error"; message: string; detail?: string | null; hint?: string | null };

async function accessOk(pathname: string, mode = fsConstants.F_OK): Promise<boolean> {
  try {
    await fs.access(pathname, mode);
    return true;
  } catch {
    return false;
  }
}

export async function testHermesProfileEnvironment(ctx: HermesProfileEnvironmentContext): Promise<unknown> {
  const checks: Check[] = [];
  let status: "pass" | "warn" | "fail" = "pass";

  try {
    const config = parseHermesProfileConfig(ctx.config);
    const home = profileHome(config.profile);
    const wrapper = profileWrapperPath(config.profile);
    const homeOk = await accessOk(home);
    const wrapperOk = await accessOk(wrapper, fsConstants.X_OK);

    checks.push({ code: "profile_config", level: "info", message: `Profile config parsed: ${config.profile}` });
    checks.push(homeOk
      ? { code: "profile_home", level: "info", message: "Profile home exists", detail: home }
      : { code: "profile_home_missing", level: "error", message: "Profile home is missing", detail: home, hint: "Provision the Hermes profile before assigning a Paperclip agent to it." });
    checks.push(wrapperOk
      ? { code: "profile_wrapper", level: "info", message: "Profile wrapper is executable", detail: wrapper }
      : { code: "profile_wrapper_missing", level: "error", message: "Profile wrapper is missing or not executable", detail: wrapper, hint: "Expected ~/.hermes/profiles/<profile>/bin/hermes-profile-wrapper.sh" });

    if (!homeOk || !wrapperOk) status = "fail";
  } catch (err) {
    status = "fail";
    checks.push({ code: "profile_config_invalid", level: "error", message: err instanceof Error ? err.message : String(err) });
  }

  return {
    adapterType: "hermes_profile",
    status,
    checks,
    testedAt: new Date().toISOString(),
  };
}
