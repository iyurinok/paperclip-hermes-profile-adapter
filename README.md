# paperclip-hermes-profile-adapter

Profile-aware Paperclip adapter for Bloom employee Hermes profiles: `adapterType: hermes_profile`.

## Why this exists

Paperclip shows `This adapter does not implement skill sync yet.` for generic adapters such as `process` because they do not expose `listSkills` / `syncSkills`. `hermes_profile` is a real Paperclip server adapter with those methods, so employee agents can stay profile-isolated without using root/main `hermes_local`.

## Integration point confirmed

Paperclip loads external adapters from `~/.paperclip/adapter-plugins.json` via:

- `@paperclipai/server/dist/services/adapter-plugin-store.js`
- `@paperclipai/server/dist/adapters/plugin-loader.js`
- `@paperclipai/server/dist/adapters/registry.js`

The external package must export `createServerAdapter()` from its package entrypoint. The loader calls it and registers the returned object. Local development can use the store record's `localPath`; no installed `dist/` patch is required.

Example plugin store record:

```json
[
  {
    "type": "hermes_profile",
    "packageName": "paperclip-hermes-profile-adapter",
    "localPath": "/Users/bloom.gallery/src/paperclip-hermes-profile-adapter"
  }
]
```

After changing the store, restart Paperclip or use its adapter reload route/UI if available.

## Agent adapter config

```json
{
  "adapterType": "hermes_profile",
  "adapterConfig": {
    "profile": "stella",
    "timeoutSec": 300,
    "persistSession": true,
    "cwd": "/Users/bloom.gallery/.hermes/profiles/stella/workspace",
    "allowedProfiles": ["stella", "cleo", "devin", "fiona", "aster"]
  }
}
```

## Runtime behavior

- Validates `profile` against a strict regex and allowlist.
- Runs only `~/.hermes/profiles/<profile>/bin/hermes-profile-wrapper.sh`; adapter config cannot supply an arbitrary command.
- Passes Paperclip run/agent/company env vars and optional local-agent JWT (`PAPERCLIP_API_KEY`).
- Persists Hermes session id as `{ profile, sessionId }` when quiet output includes `session_id:`.
- Lists profile-local skills from `~/.hermes/profiles/<profile>/skills/**/SKILL.md`.
- `syncSkills` is intentionally read-only/no-op for now: it reflects desired skills in the returned snapshot but does not copy/link/delete files.

## Safety boundaries

1. Root/main remains `hermes_local`; employee agents use `hermes_profile`.
2. No arbitrary shell command execution through adapter config.
3. Profile wrappers own profile-specific secret loading.
4. Skill sync is read-only until we explicitly design profile skill mutation.
5. Do not patch `~/.hermes/hermes-agent/` or installed Paperclip `dist/` files.

## Development

```bash
npm install
npm run build
npm test
```

## Live registration checklist

1. Build this repo: `npm run build`.
2. Add/update `~/.paperclip/adapter-plugins.json` with the localPath record above.
3. Restart Paperclip so `registry.js` reloads external adapters.
4. Confirm `hermes_profile` appears in Paperclip adapter list.
5. Update one low-risk employee agent from `process` to `hermes_profile` with an allowlisted profile.
6. Run `testEnvironment` from the Paperclip UI/API.
7. Open the agent skill panel; the unsupported-warning should be gone.
8. Run one heartbeat/task and verify the profile wrapper, not root/main, executed.

## Current risk

This is implemented as a safe scaffold. `execute` is real but should be canaried on one employee profile first because the exact Hermes wrapper CLI contract can drift. `syncSkills` deliberately does not mutate profile skills yet.
