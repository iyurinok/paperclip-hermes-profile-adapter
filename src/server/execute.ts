import { spawn } from "node:child_process";
import * as path from "node:path";
import { parseAdapterConfigFromContext, profileHome, profileWrapperPath } from "./config.js";
import { buildHermesProfileEnv } from "./profile-env.js";
import type { AdapterExecutionResult, HermesProfileAdapterConfig, HermesProfileExecutionContext } from "./types.js";

const SESSION_ID_REGEX = /^session_id:\s*(\S+)/m;

function cfgString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let rendered = template;
  rendered = rendered.replace(/\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g, vars.taskId ? "$1" : "");
  rendered = rendered.replace(/\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g, vars.taskId ? "" : "$1");
  rendered = rendered.replace(/\{\{#commentId\}\}([\s\S]*?)\{\{\/commentId\}\}/g, vars.commentId ? "$1" : "");
  return rendered.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function contextRecords(ctx: HermesProfileExecutionContext): Array<Record<string, unknown> | undefined> {
  return [ctx.context as Record<string, unknown> | undefined, ctx.runtime?.sessionParams ?? undefined, ctx.config];
}

function ctxString(ctx: HermesProfileExecutionContext, ...keys: string[]): string {
  for (const source of contextRecords(ctx)) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
  }
  return "";
}

function ctxRecord(ctx: HermesProfileExecutionContext, key: string): Record<string, unknown> | undefined {
  for (const source of contextRecords(ctx)) {
    const value = source?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return undefined;
}

function recordString(record: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function recordFrom(record: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return undefined;
}

function paperclipApiUrl(config: HermesProfileAdapterConfig): string {
  const raw = config.paperclipApiUrl ?? process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100/api";
  return raw.endsWith("/api") ? raw : raw.replace(/\/+$/, "") + "/api";
}

export function buildPrompt(ctx: HermesProfileExecutionContext, config: HermesProfileAdapterConfig): string {
  const wakePayload = ctxRecord(ctx, "paperclipWake");
  const task = ctxRecord(ctx, "task") ?? ctxRecord(ctx, "issue") ?? ctxRecord(ctx, "paperclipIssue") ?? recordFrom(wakePayload, "issue", "task");
  const comment = ctxRecord(ctx, "comment") ?? ctxRecord(ctx, "wakeComment") ?? ctxRecord(ctx, "paperclipWakeComment") ?? recordFrom(wakePayload, "latestComment", "comment", "wakeComment");
  const taskId = ctxString(ctx, "taskId", "issueId") || recordString(task, "id", "taskId", "issueId", "identifier") || recordString(wakePayload, "taskId", "issueId", "id", "identifier");
  const taskTitle = ctxString(ctx, "taskTitle", "issueTitle", "title") || recordString(task, "title", "taskTitle", "issueTitle") || recordString(wakePayload, "taskTitle", "issueTitle", "title");
  const taskBody = ctxString(ctx, "taskBody", "issueBody", "body", "description") || recordString(task, "body", "description", "taskBody", "issueBody") || recordString(wakePayload, "taskBody", "issueBody", "body", "description");
  const commentId = ctxString(ctx, "wakeCommentId", "commentId") || recordString(wakePayload, "latestCommentId", "wakeCommentId", "commentId") || recordString(comment, "id", "wakeCommentId", "commentId");
  const taskMarkdown = ctxString(ctx, "paperclipTaskMarkdown") || recordString(wakePayload, "paperclipTaskMarkdown");
  const agentName = ctx.agent?.name ?? config.profile;
  const template = config.promptTemplate ?? `You are {{agentName}}, a Hermes profile agent running under profile {{profile}} for Paperclip.

Paperclip identity:
- Agent ID: {{agentId}}
- Company ID: {{companyId}}
- API Base: {{paperclipApiUrl}}
- Run ID: {{runId}}

If assigned a task, work it using your tools. Use Authorization: Bearer $PAPERCLIP_API_KEY for Paperclip API calls when PAPERCLIP_API_KEY is present. Use X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID on mutating Paperclip API calls.

Task ID: {{taskId}}
Title: {{taskTitle}}
Comment ID: {{commentId}}

{{taskContext}}`;
  return renderTemplate(template, {
    profile: config.profile,
    agentName,
    agentId: ctx.agent?.id ?? "",
    companyId: ctx.agent?.companyId ?? "",
    paperclipApiUrl: paperclipApiUrl(config),
    runId: ctx.runId ?? "",
    taskId,
    taskTitle,
    taskBody,
    taskContext: taskMarkdown || taskBody,
    commentId,
  });
}

function cleanResponse(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !line.startsWith("session_id:"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function runProfileWrapper(ctx: HermesProfileExecutionContext, command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutSec: number; graceSec: number }): Promise<{ exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    void ctx.onSpawn?.({ pid: child.pid ?? 0, processGroupId: child.pid ? -child.pid : null, startedAt: new Date().toISOString() });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve({ exitCode, signal, timedOut, stdout, stderr });
    };

    const killTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* noop */ } }
    };

    const timeoutTimer = opts.timeoutSec > 0 ? setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), opts.graceSec * 1000).unref();
    }, opts.timeoutSec * 1000) : null;
    timeoutTimer?.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      void ctx.onLog("stdout", text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      void ctx.onLog("stderr", text);
    });
    child.on("error", (err) => {
      stderr += `${err.message}\n`;
      finish(127, null);
    });
    child.on("close", finish);
  });
}

export async function executeHermesProfile(ctx: HermesProfileExecutionContext): Promise<AdapterExecutionResult> {
  const config = parseAdapterConfigFromContext(ctx);
  const wrapper = profileWrapperPath(config.profile);
  const cwd = config.cwd ?? path.join(profileHome(config.profile), "workspace");
  const prompt = buildPrompt(ctx, config);
  const args = ["chat", "-q", prompt];

  if (config.quiet) args.push("-Q");
  if (config.toolsets) args.push("-t", config.toolsets);
  if (config.enabledToolsets?.length) args.push("-t", config.enabledToolsets.join(","));
  if (config.source) args.push("--source", config.source);
  if (config.yolo) args.push("--yolo");

  const prevSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId) ?? cfgString(ctx.runtime?.sessionId);
  if (config.persistSession && prevSessionId) args.push("--resume", prevSessionId);
  if (config.extraArgs?.length) args.push(...config.extraArgs);

  await ctx.onMeta?.({ adapterType: "hermes_profile", command: wrapper, cwd, commandArgs: ["chat", "-q", "[prompt]"], context: { profile: config.profile } });
  await ctx.onLog("stdout", `[hermes_profile] Starting profile ${config.profile} via ${wrapper}
`);

  const result = await runProfileWrapper(ctx, wrapper, args, { cwd, env: buildHermesProfileEnv(config, ctx), timeoutSec: config.timeoutSec ?? 0, graceSec: config.graceSec ?? 10 });
  const sessionId = result.stdout.match(SESSION_ID_REGEX)?.[1] ?? null;
  const response = cleanResponse(result.stdout);
  const errorMessage = result.exitCode === 0 ? null : (result.stderr.trim() || `Hermes profile exited with ${result.exitCode}`);

  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    ...(errorMessage ? { errorMessage } : {}),
    ...(sessionId ? { sessionId, sessionParams: { profile: config.profile, sessionId }, sessionDisplayId: `${config.profile}:${sessionId.slice(0, 12)}` } : {}),
    summary: response ? response.slice(0, 2000) : null,
    resultJson: {
      profile: config.profile,
      result: response,
      session_id: sessionId,
    },
  };
}
