import { executeHermesProfile } from "./execute.js";
import { listHermesProfileSkills, syncHermesProfileSkills } from "./skills.js";
import { testHermesProfileEnvironment } from "./test.js";

export const hermesProfileAdapter = {
  type: "hermes_profile",
  models: [],
  execute: executeHermesProfile,
  testEnvironment: testHermesProfileEnvironment,
  listSkills: listHermesProfileSkills,
  syncSkills: syncHermesProfileSkills,
};
