export function buildHermesProfileEnv(profile: string, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    PATH: baseEnv.PATH,
    HOME: baseEnv.HOME,
    HERMES_PROFILE: profile,
  };
}
