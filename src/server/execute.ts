import { spawn } from "node:child_process";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { parseAdapterConfigFromContext, profileHome, profileWrapperPath } from "./config.js";
import { buildHermesProfileEnv } from "./profile-env.js";
import type { AdapterExecutionResult, HermesProfileAdapterConfig, HermesProfileExecutionContext } from "./types.js";

const SESSION_ID_REGEX = /^session_id:\s*(\S+)/m;
const DEFAULT_PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";

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
  const raw = config.paperclipApiUrl ?? config.env?.PAPERCLIP_API_URL ?? DEFAULT_PAPERCLIP_API_URL;
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

If assigned a task, work it using your tools. Paperclip environment variables are already injected for the current run.

Paperclip API rules:
- Use the injected bearer token on every Paperclip API request when PAPERCLIP_API_KEY is present.
- Use X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID on every mutating Paperclip API request.
- PAPERCLIP_API_URL already includes /api; do not append another /api.
- Comment bodies use JSON key body, not bodyMarkdown.
- For task-scoped reads and writes, prefer $PAPERCLIP_TASK_ID over any remembered issue from a prior session.
- After mutating comments or status, read the issue/comments back and only claim success after the persisted state matches what you claim.

Safe task update examples:
    curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/issues/$PAPERCLIP_TASK_ID"
    curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -H "Content-Type: application/json" -d '{"body":"PASS - <concise result>"}' "$PAPERCLIP_API_URL/issues/$PAPERCLIP_TASK_ID/comments"
    curl -sS -X PATCH -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -H "Content-Type: application/json" -d '{"status":"done"}' "$PAPERCLIP_API_URL/issues/$PAPERCLIP_TASK_ID

Diff-first Paperclip lifecycle:
- Reuse the canonical task context you were woken for; do not create duplicate sibling issues that split decisions or proposed solutions.
- Move substantive code/config/docs/automation work to in_progress when you start.
- Make reversible edits, run the smallest useful verification, and post a review packet with changed files, diff stat, summary, checks run, risks, and rollback notes.
- For diff-first review, also create a pending request_confirmation interaction so the reviewer gets Paperclip accept/reject controls. The confirmation card must be self-contained for mobile review; do not rely on a nearby comment alone. Use continuationPolicy: wake_assignee, target.key: diff_first_review, target.label: Diff review, target.href pointing to the review packet comment when available, sourceCommentId set to that comment, supersedeOnUserComment: true, acceptLabel: Approve diff, rejectLabel: Request changes, and an idempotencyKey like confirmation:{issueId}:diff-first-review:{runId-or-short-diff-id}.
- Fill payload.detailsMarkdown with compact review context: changed files, diff stat, summary, checks, risks, rollback, and a pointer to the full packet. Use the same evidence from the diff-first review packet so the reviewer knows what they are approving without hunting through the thread.
- Move code/config/governance implementation to in_review, not done, with that confirmation pending unless Igor/root explicitly authorizes self-approval.
- When woken by an accepted diff_first_review confirmation, close to done. When woken by a rejected confirmation, continue work or set blocked with the requested change/input.
- If blocked, set blocked with the blocker owner and exact next action.

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


interface PaperclipTaskSnapshot {
  status?: string;
  comments: Array<{ body?: string | null; createdByRunId?: string | null; authorAgentId?: string | null }>;
}

function paperclipRequestJson<T>(url: string, token?: string, init: { method?: string; body?: unknown; runId?: string } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(body));
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.runId) headers["X-Paperclip-Run-Id"] = init.runId;
    const req = client.request(parsed, { method: init.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`Paperclip verification GET ${parsed.pathname} returned ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`Paperclip verification ${init.method ?? "GET"} ${parsed.pathname} timed out`)));
    req.end(body);
  });
}

function hasRunEvidence(snapshot: PaperclipTaskSnapshot, ctx: HermesProfileExecutionContext): boolean {
  return snapshot.comments.some((comment) =>
    comment.createdByRunId === ctx.runId ||
    (ctx.agent?.id ? comment.authorAgentId === ctx.agent.id : false),
  );
}

function claimsDoneStatus(response: string): boolean {
  return /(?:set|status|marked|move|moved|updated)[^\n.]{0,80}(?:`done`|done)/i.test(response);
}

export async function verifyTaskMutation(ctx: HermesProfileExecutionContext, env: NodeJS.ProcessEnv, response = ""): Promise<{ ok: true; status?: string; comments: number; finalized?: boolean } | { ok: false; reason: string }> {
  const taskId = env.PAPERCLIP_TASK_ID;
  if (!taskId) return { ok: true, comments: 0 };
  const apiUrl = env.PAPERCLIP_API_URL;
  if (!apiUrl) return { ok: false, reason: "PAPERCLIP_API_URL was not injected" };
  const token = env.PAPERCLIP_API_KEY;
  try {
    const base = apiUrl.replace(/\/+$/, "");
    const issue = await paperclipRequestJson<{ status?: string }>(`${base}/issues/${encodeURIComponent(taskId)}`, token);
    const comments = await paperclipRequestJson<Array<{ body?: string | null; createdByRunId?: string | null; authorAgentId?: string | null }>>(`${base}/issues/${encodeURIComponent(taskId)}/comments`, token);
    const snapshot = { status: issue.status, comments: Array.isArray(comments) ? comments : [] };
    const profileReportedAuthFailure = /Unauthorized/i.test(response);
    const hasEvidence = hasRunEvidence(snapshot, ctx);
    if (profileReportedAuthFailure && !hasEvidence) {
      return { ok: false, reason: `Profile reported Paperclip API authorization failure for ${taskId}` };
    }
    if (/No persisted task mutation evidence/i.test(response)) {
      return { ok: false, reason: `Profile reported no persisted task mutation evidence for ${taskId}` };
    }
    if (hasEvidence && snapshot.status !== "done") {
      if (!token || !env.PAPERCLIP_RUN_ID) {
        return { ok: false, reason: `Run evidence persisted for ${taskId}, but status is ${snapshot.status ?? "unknown"}; missing token/run id for adapter finalization` };
      }
      const finalized = await paperclipRequestJson<{ status?: string }>(`${base}/issues/${encodeURIComponent(taskId)}`, token, {
        method: "PATCH",
        body: { status: "done" },
        runId: env.PAPERCLIP_RUN_ID,
      });
      if (finalized.status !== "done") {
        return { ok: false, reason: `Adapter finalization for ${taskId} did not persist done status; status=${finalized.status ?? "unknown"}` };
      }
      return { ok: true, status: finalized.status, comments: snapshot.comments.length, finalized: true };
    }
    if (claimsDoneStatus(response) && snapshot.status !== "done") {
      if (!token || !env.PAPERCLIP_RUN_ID) {
        return { ok: false, reason: `Profile claimed done status for ${taskId}, but persisted status is ${snapshot.status ?? "unknown"}; missing token/run id for adapter finalization` };
      }
      const finalized = await paperclipRequestJson<{ status?: string }>(`${base}/issues/${encodeURIComponent(taskId)}`, token, {
        method: "PATCH",
        body: { status: "done" },
        runId: env.PAPERCLIP_RUN_ID,
      });
      if (finalized.status !== "done") {
        return { ok: false, reason: `Adapter finalization for ${taskId} did not persist done status; status=${finalized.status ?? "unknown"}` };
      }
      return { ok: true, status: finalized.status, comments: snapshot.comments.length, finalized: true };
    }
    if (snapshot.status === "done" || hasEvidence) {
      return { ok: true, status: snapshot.status, comments: snapshot.comments.length };
    }
    return { ok: false, reason: `No persisted task mutation evidence for ${taskId}: status=${snapshot.status ?? "unknown"}, comments=${snapshot.comments.length}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }
}

function cleanResponse(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !line.startsWith("session_id:"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isSilentTaskScopedSuccess(input: { exitCode: number | null; timedOut: boolean; response: string; taskId?: string | null }): boolean {
  if (!input.taskId || input.exitCode !== 0 || input.timedOut) return false;
  const response = input.response.trim();
  return response.length === 0 || response === "[SILENT]";
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

  const env = buildHermesProfileEnv(config, ctx);
  const prevSessionId = config.persistSession && !env.PAPERCLIP_TASK_ID ? (cfgString(ctx.runtime?.sessionParams?.sessionId) ?? cfgString(ctx.runtime?.sessionId)) : undefined;
  if (prevSessionId) args.push("--resume", prevSessionId);
  if (config.extraArgs?.length) args.push(...config.extraArgs);

  await ctx.onMeta?.({ adapterType: "hermes_profile", command: wrapper, cwd, commandArgs: ["chat", "-q", "[prompt]"], context: { profile: config.profile, freshTaskSession: Boolean(env.PAPERCLIP_TASK_ID) } });
  await ctx.onLog("stdout", `[hermes_profile] Starting profile ${config.profile} via ${wrapper}
`);

  const result = await runProfileWrapper(ctx, wrapper, args, { cwd, env, timeoutSec: config.timeoutSec ?? 0, graceSec: config.graceSec ?? 10 });
  const sessionId = result.stdout.match(SESSION_ID_REGEX)?.[1] ?? null;
  const response = cleanResponse(result.stdout);
  const silentTaskSuccess = isSilentTaskScopedSuccess({ exitCode: result.exitCode, timedOut: result.timedOut, response, taskId: env.PAPERCLIP_TASK_ID });
  const mutationVerification: Awaited<ReturnType<typeof verifyTaskMutation>> = !silentTaskSuccess && result.exitCode === 0 ? await verifyTaskMutation(ctx, env, response) : { ok: true as const, comments: 0 };
  const mutationFailure = mutationVerification.ok === false ? mutationVerification.reason : null;
  const errorMessage = silentTaskSuccess
    ? `Hermes profile ${config.profile} exited successfully but produced no task result for ${env.PAPERCLIP_TASK_ID}`
    : mutationFailure
      ? `Hermes profile ${config.profile} exited successfully but task verification failed: ${mutationFailure}`
      : result.exitCode === 0 ? null : (result.stderr.trim() || `Hermes profile exited with ${result.exitCode}`);

  return {
    exitCode: silentTaskSuccess || mutationFailure ? 1 : result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    ...(errorMessage ? { errorMessage } : {}),
    ...(sessionId ? { sessionId, sessionParams: { profile: config.profile, sessionId }, sessionDisplayId: `${config.profile}:${sessionId.slice(0, 12)}` } : {}),
    summary: response ? response.slice(0, 2000) : null,
    resultJson: {
      profile: config.profile,
      result: response,
      session_id: sessionId,
      taskVerification: mutationVerification,
    },
  };
}
