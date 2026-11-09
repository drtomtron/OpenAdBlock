<!-- Thanks for contributing. Keep this short; delete anything that does not apply. -->

## What this changes

<!-- One or two sentences. Link the issue it closes, if there is one. -->

## Why

<!-- The problem it solves. For an engine change, say which filter or site made it necessary. -->

## How it was tested

- [ ] `npm run check` passes (lint and the full test suite)
- [ ] New or changed behaviour has a test in `test/`
- [ ] Loaded in Firefox via `about:debugging` and exercised by hand

<!-- For a blocking change, name the sites and filter lists you tried it against. -->

## Checklist

- [ ] No new runtime dependencies
- [ ] Nothing is sent to any server
- [ ] Modules in `src/lib/` still avoid `browser.*` so they stay unit testable
- [ ] Any filter option that cannot be honoured is rejected, not approximated
- [ ] Documentation updated if behaviour or supported syntax changed
      (`docs/FILTER_SYNTAX.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`)
- [ ] The code is original, not copied from another ad blocker
