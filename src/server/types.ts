export type LogStream = "stdout" | "stderr";

export interface AdapterAgentLike {
  id?: string;
  companyId?: string;
  name?: string;
  adapterConfig?: unknown;
}

export interface AdapterRuntimeLike {
  sessionId?: string | null;
  sessionParams?: Record<string, unknown> | null;
  sessionDisplayId?: string | null;
  taskKey?: string | null;
}

export interface HermesProfileAdapterConfig {
  profile: string;
  allowedProfiles?: string[];
  timeoutSec?: number;
  graceSec?: number;
  persistSession?: boolean;
  cwd?: string;
  paperclipApiUrl?: string;
  promptTemplate?: string;
  quiet?: boolean;
  yolo?: boolean;
  source?: string;
  toolsets?: string;
  enabledToolsets?: string[];
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface AdapterExecutionTaskContext {
  id?: string;
  taskId?: string;
  issueId?: string;
  title?: string;
  taskTitle?: string;
  issueTitle?: string;
  body?: string;
  description?: string;
  taskBody?: string;
  issueBody?: string;
}

export interface AdapterExecutionCommentContext {
  id?: string;
  wakeCommentId?: string;
  commentId?: string;
}

export interface PaperclipWakeContext {
  taskId?: string;
  issueId?: string;
  taskTitle?: string;
  issueTitle?: string;
  title?: string;
  taskBody?: string;
  issueBody?: string;
  body?: string;
  description?: string;
  wakeCommentId?: string;
  commentId?: string;
  task?: AdapterExecutionTaskContext;
  issue?: AdapterExecutionTaskContext;
  comment?: AdapterExecutionCommentContext;
  wakeComment?: AdapterExecutionCommentContext;
}

export interface HermesProfileExecutionContext {
  runId: string;
  agent: AdapterAgentLike;
  runtime: AdapterRuntimeLike;
  config: Record<string, unknown>;
  context?: PaperclipWakeContext;
  authToken?: string;
  onLog: (stream: LogStream, chunk: string) => Promise<void>;
  onMeta?: (meta: Record<string, unknown>) => Promise<void>;
  onSpawn?: (meta: { pid: number; processGroupId: number | null; startedAt: string }) => Promise<void>;
}

export interface HermesProfileSkillContext {
  agentId: string;
  companyId: string;
  adapterType: string;
  config: Record<string, unknown>;
}

export interface HermesProfileEnvironmentContext {
  companyId: string;
  adapterType: string;
  config: Record<string, unknown>;
}

export interface AdapterSkillEntry {
  key: string;
  runtimeName: string | null;
  desired: boolean;
  managed: boolean;
  required?: boolean;
  requiredReason?: string | null;
  state: "available" | "configured" | "installed" | "missing" | "stale" | "external";
  origin?: "company_managed" | "paperclip_required" | "user_installed" | "external_unknown";
  originLabel?: string | null;
  locationLabel?: string | null;
  readOnly?: boolean;
  sourcePath?: string | null;
  targetPath?: string | null;
  detail?: string | null;
}

export interface AdapterSkillSnapshot {
  adapterType: string;
  supported: boolean;
  mode: "unsupported" | "persistent" | "ephemeral";
  desiredSkills: string[];
  entries: AdapterSkillEntry[];
  warnings: string[];
}

export interface AdapterExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string | null;
  sessionId?: string | null;
  sessionParams?: Record<string, unknown> | null;
  sessionDisplayId?: string | null;
  provider?: string | null;
  model?: string | null;
  resultJson?: Record<string, unknown> | null;
  summary?: string | null;
  clearSession?: boolean;
}
