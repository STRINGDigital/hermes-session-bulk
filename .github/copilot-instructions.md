# Instructions for GitHub Copilot

This repo is one Hermes Desktop plugin by String Digital: `desktop/plugin.js`, described by
`plugin.yaml`. Hermes loads it from `~/.hermes/desktop-plugins/session-bulk/plugin.js` or
installs it with `hermes plugins install STRINGDigital/hermes-session-bulk`.

## Rules for every change

1. **Plugin SDK only.** Import only from `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`.
   Do not import `jsx` from `@hermes/plugin-sdk`: it has no such export and the plugin then
   fails to load and cannot be switched off. Build elements with `jsx`/`jsxs` from
   `react/jsx-runtime`.
2. **No new reach into the app's markup.** Do not add `document.querySelector*` calls on
   `data-slot`, `data-tour`, `data-sidebar` or `data-testid`, and no new
   `MutationObserver` on `document.body`. The Hermes plugin catalog refuses both. The two
   existing ones (row discovery in `discoverRows()` and the observer in `register()`) are known
   and are to be removed once the SDK exports `useContributions` (NousResearch/hermes-agent#155192).
3. **No personal data.** No names, email addresses, local file paths, session content,
   tokens or keys in code, comments, tests, commits or PR text.
4. **No network calls of its own** and no self-updating code. The plugin talks only to the local
   Hermes gateway through `host.request`.
5. **Deleting stays two-click.** The delete button arms on the first click and deletes on the
   second. Keep that.
6. **Keep `window.hermesDesktop.api` feature-detected.** It is not part of the SDK.
7. **Bump `version` in `plugin.yaml`** for any change to `desktop/plugin.js`.

## How to check a change

- `node --check` on a copy of `desktop/plugin.js` renamed to `.mjs` must pass (the CI
  workflow does this).
- The CI workflow also reports the catalog's DOM-reach patterns; do not add new ones.
- You cannot run Hermes Desktop here. Say in the PR what you could not test in the app; the
  maintainer tests UI changes in a real Hermes Desktop before merging.

## Upstream code worth reading

- Sidebar row ordering: `apps/desktop/src/store/sidebar-nav.ts` (`applySidebarNavPrefs`).
- Sidebar rows and their `data-tour` tags: `apps/desktop/src/app/chat/sidebar/index.tsx`.
- SDK exports: `apps/desktop/src/sdk/index.ts`.
- Catalog admission rules: `plugin-catalog/README.md`.

All in https://github.com/NousResearch/hermes-agent.
