# Sessions (bulk) for Hermes Desktop

A [Hermes Desktop](https://github.com/NousResearch/hermes-agent) plugin by
**[String Digital](https://stringdigital.ca)**.

It adds a **Sessions (bulk)** row to the sidebar. The page has two tabs.

## Sessions

- List every session, newest first, with its date, message count and source.
- Filter by title, preview or id.
- Select one, several, or all shown, then **Archive** or **Delete** them in one go.
- Delete asks for a second click and names the count both times. Archive is reversible.
- "Select all" covers only the rows the filter shows, so hidden rows are never deleted.

## Sidebar order

Choose the order of the sidebar rows under **New session**:

| Mode | What it does |
|---|---|
| Default | The order Hermes gives them. |
| A → Z / Z → A | Alphabetical by label. Re-sorts when a new plugin adds a row. |
| Custom | Drag a row, or use the ↑ ↓ buttons. Moving any row switches to Custom. |

"New session" always stays first. The order applies to the sidebar at once and
survives a restart. Turning the plugin off puts the default order back.

## Install

```bash
hermes plugins install STRINGDigital/hermes-session-bulk
```

Or copy this folder to `~/.hermes/desktop-plugins/session-bulk/`. Hermes picks it
up without a restart.

## Privacy

Nothing leaves your machine. The plugin reads sessions from your local Hermes
gateway while the page is open, and stores the sidebar order in its own
local plugin storage. It makes no network calls of its own.

## Known limits

- **Sidebar order** finds the rows by reading the sidebar's `data-tour` labels,
  because the plugin SDK has no call that lists them. If a Hermes update renames
  those labels, the tab shows "No sidebar rows found" and your saved order is kept.
  This is also why the plugin is not in the official catalog yet; a request for
  an SDK hook is open with the Hermes project.
- **Archive** uses the desktop bridge `window.hermesDesktop.api`, which is not
  part of the plugin SDK. If a build removes it, the Archive button disables
  itself and says why. Delete keeps working.

Tested on Hermes Desktop v0.21.6 (macOS).

## Licence

MIT. Copyright (c) 2026 String Digital. Contributions welcome.
