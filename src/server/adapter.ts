import { executeHermesProfile } from "./execute.js";
import { listHermesProfileSkills, syncHermesProfileSkills } from "./skills.js";
import { testHermesProfileEnvironment } from "./test.js";
import { hermesProfileSessionCodec } from "./session-codec.js";

export const hermesProfileAdapter = {
  type: "hermes_profile",
  models: [],
  execute: executeHermesProfile,
  testEnvironment: testHermesProfileEnvironment,
  listSkills: listHermesProfileSkills,
  syncSkills: syncHermesProfileSkills,
  sessionCodec: hermesProfileSessionCodec,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
};
