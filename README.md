# paperclip-hermes-profile-adapter

Draft repository for a profile-aware Paperclip adapter: `adapterType: hermes_profile`.

## Purpose

Make Bloom employee Hermes profiles first-class Paperclip agents without using the generic `process` adapter. This should remove the Paperclip skill-sync warning while preserving profile isolation.

## Non-goals

- Do not patch `~/.hermes/hermes-agent/` upstream source.
- Do not patch installed Paperclip `dist/` files by hand.
- Do not expose arbitrary shell command execution through adapter config.
- Do not let employee profile agents run as root/main Hermes.

## Proposed file structure

```text
paperclip-hermes-profile-adapter/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    server/
      index.ts
      adapter.ts
      execute.ts
      test.ts
      skills.ts
      config.ts
      profile-env.ts
      session-codec.ts
      types.ts
  tests/
    adapter.test.js
    config.test.js
    skills.test.js
    profile-env.test.js
```

## Paperclip integration model

Paperclip server discovers/loads an adapter module, then registers a server adapter object. The adapter must present the same server-adapter surface Paperclip already checks in `@paperclipai/server` routes:

- `type: "hermes_profile"`
- `execute(...)`
- `testEnvironment(...)`
- `listSkills(...)`
- `syncSkills(...)`

Paperclip's agent skill routes currently do roughly this:

```text
GET /agents/:id/skills
  -> findActiveServerAdapter(agent.adapterType)
  -> if adapter.listSkills missing: unsupported snapshot / warning
  -> else adapter.listSkills(...)

POST /agents/:id/skills/sync
  -> findActiveServerAdapter(agent.adapterType)
  -> if adapter.syncSkills exists: adapter.syncSkills(...)
  -> else if adapter.listSkills exists: adapter.listSkills(...)
  -> else unsupported snapshot / warning
```

So `hermes_profile` integrates by becoming a real active server adapter. Once Paperclip sees `listSkills`/`syncSkills`, the UI warning disappears.

## Runtime model

Example Paperclip agent config:

```json
{
  "adapterType": "hermes_profile",
  "adapterConfig": {
    "profile": "stella",
    "timeoutSec": 300,
    "persistSession": true,
    "cwd": "/Users/bloom.gallery",
    "allowedProfiles": ["stella", "cleo", "devin", "fiona", "aster"]
  }
}
```

Execution flow:

```text
Paperclip issue/run
  -> adapterType hermes_profile
  -> validate adapterConfig.profile against allowlist
  -> resolve ~/.hermes/profiles/<profile>
  -> inject profile env from /profiles/<profile> or use profile wrapper
  -> run Hermes explicitly as that profile
  -> return result to Paperclip
```

Preferred execution command initially:

```bash
~/.hermes/profiles/stella/bin/hermes-profile-wrapper.sh chat -q '<prompt>'
```

This reuses the wrapper that already handles profile-specific Infisical/LiteLLM/Honcho setup. Later, if safer, the adapter can call:

```bash
hermes --profile stella chat -q '<prompt>'
```

## Safety boundaries

1. `profile` must match a strict name regex and allowlist.
2. No arbitrary `command` field in Paperclip adapter config.
3. Root/main remains `hermes_local`; employees use `hermes_profile`.
4. Secrets come from `/profiles/<name>`, not root `/`, except shared infra endpoints.
5. `listSkills` reads profile-local skill inventory.
6. Initial `syncSkills` should be no-op/read-only or only update desired-skill preference; no automatic copying from root global skills.
7. Logs redact tokens, keys, chat IDs, and secret paths in any public-facing output.
8. Timeout cleanup must terminate child Hermes process trees.

## Open integration question

Need to verify Paperclip's supported external adapter registration mechanism. If Paperclip does not currently support loading external adapter packages by config, integration will need a small upstream/maintained Paperclip extension point rather than editing installed `dist/`.
