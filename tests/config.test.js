import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHermesProfileConfig, profileWrapperPath } from '../dist/server/config.js';
import { hermesProfileSessionCodec } from '../dist/server/session-codec.js';
import { listHermesProfileSkills, syncHermesProfileSkills } from '../dist/server/skills.js';
import { createServerAdapter } from '../dist/index.js';

test('createServerAdapter returns hermes_profile surface', () => {
  const adapter = createServerAdapter();
  assert.equal(adapter.type, 'hermes_profile');
  assert.equal(typeof adapter.execute, 'function');
  assert.equal(typeof adapter.testEnvironment, 'function');
  assert.equal(typeof adapter.listSkills, 'function');
  assert.equal(typeof adapter.syncSkills, 'function');
});

test('config parser requires allowlisted strict profile', () => {
  assert.equal(parseHermesProfileConfig({ profile: 'stella' }).profile, 'stella');
  assert.throws(() => parseHermesProfileConfig({ profile: '../main' }), /Invalid hermes_profile/);
  assert.throws(() => parseHermesProfileConfig({ profile: 'root', allowedProfiles: ['stella'] }), /not allowlisted/);
});

test('profile wrapper path is fixed and not config-controlled', () => {
  assert.match(profileWrapperPath('stella'), /\.hermes\/profiles\/stella\/bin\/hermes-profile-wrapper\.sh$/);
});

test('session codec round-trips profile session refs', () => {
  const serialized = hermesProfileSessionCodec.serialize({ profile: 'stella', sessionId: 'abcdef1234567890' });
  assert.deepEqual(serialized, { profile: 'stella', sessionId: 'abcdef1234567890' });
  assert.equal(hermesProfileSessionCodec.getDisplayId(serialized), 'stella:abcdef123456');
});

test('skill listing returns supported snapshot', async () => {
  const snapshot = await listHermesProfileSkills({ agentId: 'a', companyId: 'c', adapterType: 'hermes_profile', config: { profile: 'stella' } });
  assert.equal(snapshot.adapterType, 'hermes_profile');
  assert.equal(snapshot.supported, true);
  assert.equal(snapshot.mode, 'persistent');
  assert.ok(Array.isArray(snapshot.entries));
});

test('syncSkills preserves desired skills without surfacing read-only warnings', async () => {
  const snapshot = await syncHermesProfileSkills({ agentId: 'a', companyId: 'c', adapterType: 'hermes_profile', config: { profile: 'stella' } }, ['hermes-profile/devops/paperclip-mcp']);
  assert.deepEqual(snapshot.desiredSkills, ['hermes-profile/devops/paperclip-mcp']);
  assert.deepEqual(snapshot.warnings, []);
});
