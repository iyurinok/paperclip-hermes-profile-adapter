import type { HermesProfileAdapterConfig, HermesProfileExecutionContext } from "./types.js";

export function buildHermesProfileEnv(
  config: HermesProfileAdapterConfig,
  ctx?: HermesProfileExecutionContext,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    HERMES_PROFILE: config.profile,
    PAPERCLIP_ADAPTER_TYPE: "hermes_profile",
  };

  if (ctx?.runId) env.PAPERCLIP_RUN_ID = ctx.runId;
  if (ctx?.agent?.id) env.PAPERCLIP_AGENT_ID = ctx.agent.id;
  if (ctx?.agent?.companyId) env.PAPERCLIP_COMPANY_ID = ctx.agent.companyId;
  if (ctx?.authToken && !env.PAPERCLIP_API_KEY) env.PAPERCLIP_API_KEY = ctx.authToken;
  if (typeof ctx?.config?.taskId === "string") env.PAPERCLIP_TASK_ID = ctx.config.taskId;
  if (config.paperclipApiUrl) env.PAPERCLIP_API_URL = config.paperclipApiUrl;

  if (config.env) {
    Object.assign(env, config.env);
  }

  return env;
}
