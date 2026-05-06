import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHermesProfileEnv } from '../dist/server/profile-env.js';
import { buildPrompt } from '../dist/server/execute.js';

const baseCtx = {
  runId: 'run-123',
  agent: { id: 'agent-1', companyId: 'company-1' },
  runtime: { sessionParams: null, sessionId: 'session-1', taskKey: null },
  config: { profile: 'stella' },
  onLog: async () => {},
};

test('buildHermesProfileEnv propagates nested wake task and comment context', () => {
  const env = buildHermesProfileEnv(
    { profile: 'stella', paperclipApiUrl: 'https://paperclip.example/api' },
    {
      ...baseCtx,
      context: {
        task: { id: 'BLO-123', title: 'Do the thing', body: 'Fix the thing' },
        wakeComment: { id: 'comment-456' },
        wakeReason: 'issue-wake',
        linkedIssueIds: ['BLO-1', ' BLO-2 ', ''],
      },
    },
    { PATH: '/usr/bin' },
  );

  assert.equal(env.HERMES_PROFILE, 'stella');
  assert.equal(env.PAPERCLIP_ADAPTER_TYPE, 'hermes_profile');
  assert.equal(env.PAPERCLIP_RUN_ID, 'run-123');
  assert.equal(env.PAPERCLIP_AGENT_ID, 'agent-1');
  assert.equal(env.PAPERCLIP_COMPANY_ID, 'company-1');
  assert.equal(env.PAPERCLIP_TASK_ID, 'BLO-123');
  assert.equal(env.PAPERCLIP_WAKE_COMMENT_ID, 'comment-456');
  assert.equal(env.PAPERCLIP_WAKE_REASON, 'issue-wake');
  assert.equal(env.PAPERCLIP_LINKED_ISSUE_IDS, 'BLO-1,BLO-2');
  assert.equal(env.PAPERCLIP_API_URL, 'https://paperclip.example/api');
});

test('buildHermesProfileEnv defaults API URL to local Paperclip API', () => {
  const env = buildHermesProfileEnv(
    { profile: 'devin' },
    baseCtx,
    { PATH: '/usr/bin', PAPERCLIP_API_URL: 'https://paperclip.bloom.gallery/api' },
  );

  assert.equal(env.PAPERCLIP_API_URL, 'http://127.0.0.1:3100/api');
});

test('buildPrompt defaults API URL to local Paperclip API', () => {
  const previousUrl = process.env.PAPERCLIP_API_URL;
  process.env.PAPERCLIP_API_URL = 'https://paperclip.bloom.gallery/api';
  try {
    const prompt = buildPrompt(baseCtx, { profile: 'devin' });

    assert.match(prompt, /API Base: http:\/\/127\.0\.0\.1:3100\/api/);
  } finally {
    if (previousUrl === undefined) {
      delete process.env.PAPERCLIP_API_URL;
    } else {
      process.env.PAPERCLIP_API_URL = previousUrl;
    }
  }
});

test('buildHermesProfileEnv normalizes API URL after env overrides', () => {
  const env = buildHermesProfileEnv(
    { profile: 'devin', env: { PAPERCLIP_API_URL: 'http://127.0.0.1:3100/' } },
    baseCtx,
    { PATH: '/usr/bin', PAPERCLIP_API_URL: 'https://paperclip.bloom.gallery/api' },
  );

  assert.equal(env.PAPERCLIP_API_URL, 'http://127.0.0.1:3100/api');
});

test('buildHermesProfileEnv falls back to runtime session params when wake context is absent', () => {
  const env = buildHermesProfileEnv(
    { profile: 'cleo' },
    {
      ...baseCtx,
      context: undefined,
      runtime: {
        sessionParams: {
          paperclipWake: {
            issueId: 'BLO-999',
            taskTitle: 'runtime task',
            taskBody: 'runtime body',
            wakeCommentId: 'comment-999',
            wakeReason: 'runtime-wake',
          },
        },
        sessionId: 'session-2',
        taskKey: 'runtime-task-key',
      },
    },
    { PATH: '/usr/bin' },
  );

  assert.equal(env.PAPERCLIP_TASK_ID, 'BLO-999');
  assert.equal(env.PAPERCLIP_WAKE_COMMENT_ID, 'comment-999');
  assert.equal(env.PAPERCLIP_WAKE_REASON, 'runtime-wake');
});

test('buildPrompt uses nested paperclipWake task, title, and comment data', () => {
  const prompt = buildPrompt(
    {
      ...baseCtx,
      context: {
        paperclipWake: {
          taskId: 'BLO-222',
          taskTitle: 'wake title',
          taskBody: 'wake body',
          wakeCommentId: 'comment-222',
        },
      },
    },
    { profile: 'stella' },
  );

  assert.match(prompt, /Task ID: BLO-222/);
  assert.match(prompt, /Title: wake title/);
  assert.match(prompt, /Comment ID: comment-222/);
  assert.match(prompt, /Diff-first Paperclip lifecycle:/);
  assert.match(prompt, /Move code\/config\/governance implementation to in_review, not done/);
  assert.match(prompt, /request_confirmation interaction/);
  assert.match(prompt, /target\.key: diff_first_review/);
  assert.match(prompt, /Approve diff/);
  assert.match(prompt, /Request changes/);
  assert.match(prompt, /detailsMarkdown with changed files\/diff stat\/summary\/checks\/rollback pointer/);
  assert.match(prompt, /wake body/);
});
