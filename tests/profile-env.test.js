import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHermesProfileEnv } from '../dist/server/profile-env.js';

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

test('buildHermesProfileEnv falls back to runtime session params when wake context is absent', () => {
  const env = buildHermesProfileEnv(
    { profile: 'cleo' },
    {
      ...baseCtx,
      context: undefined,
      runtime: {
        sessionParams: {
          issue: { id: 'BLO-999', title: 'runtime task', description: 'runtime body' },
          comment: { id: 'comment-999' },
          wake_reason: 'runtime-wake',
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
