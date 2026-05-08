import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHermesProfileEnv } from '../dist/server/profile-env.js';
import { createServer } from 'node:http';
import { buildPrompt, isSilentTaskScopedSuccess, verifyTaskMutation } from '../dist/server/execute.js';

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
  assert.match(prompt, /Paperclip API rules:/);
  assert.match(prompt, /PAPERCLIP_API_URL already includes \/api/);
  assert.match(prompt, /Comment bodies use JSON key body, not bodyMarkdown/);
  assert.match(prompt, /prefer \$PAPERCLIP_TASK_ID/);
  assert.match(prompt, /only claim success after the persisted state matches what you claim/);
  assert.match(prompt, /Safe task update examples:/);
  assert.match(prompt, /issues\/\$PAPERCLIP_TASK_ID\/comments/);
  assert.match(prompt, /Diff-first Paperclip lifecycle:/);
  assert.match(prompt, /Move code\/config\/governance implementation to in_review, not done/);
  assert.match(prompt, /request_confirmation interaction/);
  assert.match(prompt, /target\.key: diff_first_review/);
  assert.match(prompt, /target\.label: Diff review/);
  assert.match(prompt, /sourceCommentId/);
  assert.match(prompt, /supersedeOnUserComment: true/);
  assert.match(prompt, /confirmation card must be self-contained for mobile review/);
  assert.match(prompt, /payload\.detailsMarkdown/);
  assert.match(prompt, /compact review context: changed files, diff stat, summary, checks, risks, rollback/);
  assert.match(prompt, /reviewer knows what they are approving/);
  assert.match(prompt, /Approve diff/);
  assert.match(prompt, /Request changes/);
  assert.match(prompt, /wake body/);
});

test('isSilentTaskScopedSuccess fails empty and silent task-scoped successes', () => {
  assert.equal(isSilentTaskScopedSuccess({ exitCode: 0, timedOut: false, response: '', taskId: 'BLO-1' }), true);
  assert.equal(isSilentTaskScopedSuccess({ exitCode: 0, timedOut: false, response: '[SILENT]', taskId: 'BLO-1' }), true);
});

test('isSilentTaskScopedSuccess allows non-task and explicit task responses', () => {
  assert.equal(isSilentTaskScopedSuccess({ exitCode: 0, timedOut: false, response: '[SILENT]', taskId: '' }), false);
  assert.equal(isSilentTaskScopedSuccess({ exitCode: 0, timedOut: false, response: 'SMOKE_PASS BLO-1', taskId: 'BLO-1' }), false);
  assert.equal(isSilentTaskScopedSuccess({ exitCode: 1, timedOut: false, response: '[SILENT]', taskId: 'BLO-1' }), false);
  assert.equal(isSilentTaskScopedSuccess({ exitCode: 0, timedOut: true, response: '[SILENT]', taskId: 'BLO-1' }), false);
});


function withPaperclipTestServer(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

test('verifyTaskMutation passes when run-linked comment exists', async () => {
  const server = await withPaperclipTestServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/issues/BLO-1') {
      res.end(JSON.stringify({ status: 'done' }));
      return;
    }
    if (req.url === '/api/issues/BLO-1/comments') {
      res.end(JSON.stringify([{ body: 'SMOKE_PASS', createdByRunId: 'run-123' }]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  try {
    const { port } = server.address();
    const result = await verifyTaskMutation(baseCtx, {
      PAPERCLIP_TASK_ID: 'BLO-1',
      PAPERCLIP_RUN_ID: 'run-123',
      PAPERCLIP_API_URL: `http://127.0.0.1:${port}/api`,
    });
    assert.deepEqual(result, { ok: true, status: 'done', comments: 1 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('verifyTaskMutation fails without persisted task evidence', async () => {
  const server = await withPaperclipTestServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/issues/BLO-1') {
      res.end(JSON.stringify({ status: 'in_progress' }));
      return;
    }
    if (req.url === '/api/issues/BLO-1/comments') {
      res.end(JSON.stringify([]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  try {
    const { port } = server.address();
    const result = await verifyTaskMutation(baseCtx, {
      PAPERCLIP_TASK_ID: 'BLO-1',
      PAPERCLIP_RUN_ID: 'run-123',
      PAPERCLIP_API_URL: `http://127.0.0.1:${port}/api`,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /No persisted task mutation evidence/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('verifyTaskMutation fails when response claims done but status is not done', async () => {
  const server = await withPaperclipTestServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/issues/BLO-1') {
      res.end(JSON.stringify({ status: 'in_progress' }));
      return;
    }
    if (req.url === '/api/issues/BLO-1/comments') {
      res.end(JSON.stringify([{ body: 'SMOKE_PASS', createdByRunId: 'run-123' }]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  try {
    const { port } = server.address();
    const result = await verifyTaskMutation(baseCtx, {
      PAPERCLIP_TASK_ID: 'BLO-1',
      PAPERCLIP_RUN_ID: 'run-123',
      PAPERCLIP_API_URL: `http://127.0.0.1:${port}/api`,
    }, 'added SMOKE_PASS and set status to `done`');
    assert.equal(result.ok, false);
    assert.match(result.reason, /missing token\/run id/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('verifyTaskMutation finalizes done when response claims done and run auth is present', async () => {
  const requests = [];
  const server = await withPaperclipTestServer((req, res) => {
    requests.push({ method: req.method, url: req.url, runId: req.headers['x-paperclip-run-id'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/issues/BLO-1' && req.method === 'GET') {
      res.end(JSON.stringify({ status: 'in_progress' }));
      return;
    }
    if (req.url === '/api/issues/BLO-1' && req.method === 'PATCH') {
      res.end(JSON.stringify({ status: 'done' }));
      return;
    }
    if (req.url === '/api/issues/BLO-1/comments') {
      res.end(JSON.stringify([{ body: 'SMOKE_PASS', createdByRunId: 'run-123' }]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  try {
    const { port } = server.address();
    const result = await verifyTaskMutation(baseCtx, {
      PAPERCLIP_TASK_ID: 'BLO-1',
      PAPERCLIP_RUN_ID: 'run-123',
      PAPERCLIP_API_URL: `http://127.0.0.1:${port}/api`,
      PAPERCLIP_API_KEY: 'token-123',
    }, 'added SMOKE_PASS and set status to done');
    assert.deepEqual(result, { ok: true, status: 'done', comments: 1, finalized: true });
    assert.equal(requests.some((request) => request.method === 'PATCH' && request.runId === 'run-123'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('verifyTaskMutation fails when profile reports authorization failure', async () => {
  const server = await withPaperclipTestServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/issues/BLO-1') {
      res.end(JSON.stringify({ status: 'in_progress' }));
      return;
    }
    if (req.url === '/api/issues/BLO-1/comments') {
      res.end(JSON.stringify([{ body: 'old', createdByRunId: 'old-run' }]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  try {
    const { port } = server.address();
    const result = await verifyTaskMutation(baseCtx, {
      PAPERCLIP_TASK_ID: 'BLO-1',
      PAPERCLIP_RUN_ID: 'run-123',
      PAPERCLIP_API_URL: `http://127.0.0.1:${port}/api`,
    }, 'Paperclip API returned `Unauthorized` for both reads');
    assert.equal(result.ok, false);
    assert.match(result.reason, /authorization failure/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
