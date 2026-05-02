export interface HermesProfileAdapterConfig {
  profile: string;
  timeoutSec?: number;
  persistSession?: boolean;
  cwd?: string;
  allowedProfiles?: string[];
}

export interface HermesProfileRuntimeContext {
  agentId: string;
  companyId: string;
  adapterType: "hermes_profile";
  config: HermesProfileAdapterConfig;
}
