# tabane

A minimal MV3 Chrome extension that **bundles Slack sidebar channels into a multi-level tree**
by their name prefix, plus a few quality-of-life fixes for using Slack in the browser.

*tabane* (束ね) is Japanese for "a bundle".

日本語版は [README.ja.md](README.ja.md) にあります。

```
# general
# proj┬/
#     ├dev┬backend
#     │   └frontend
#     ├ops┬a
#         └b
# random
```

## Why this exists

[yamadashy/slack-channels-grouping](https://github.com/yamadashy/slack-channels-grouping) does
one level of prefix grouping and is no longer actively updated. Multi-level (nested) grouping was
proposed in its [PR #149](https://github.com/yamadashy/slack-channels-grouping/pull/149) but has
been a draft for a long time. This is a from-scratch rewrite with nesting as the core feature,
no build step and no runtime dependencies, so that keeping up with Slack's DOM changes stays cheap.

## Features

| Feature | Where it runs | Status |
|---|---|---|
| **Sidebar grouping** – nested tree by `-` / `_` prefixes, up to 3 levels. Click a group's `┬` to fold it: the first row stays as `proj ▸ 5`, bold with a mention badge when the hidden rows have unreads; folds are remembered per workspace | `app.slack.com` | Grouping **verified on live Slack** (2026-09-08); folding verified against the fixture |
| **Open in browser** – follows the "use Slack in your browser" link instead of waiting for the desktop app | `*.slack.com/archives/*`, `*.slack.com/ssb/redirect*` | Ported from [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App); not yet verified |
| **Workspace switcher** – keeps Slack's own workspace column (one icon per signed-in workspace) always visible: a ChromeOS user agent makes Slack list every workspace, and CSS un-hides the column | `app.slack.com` | **Verified on live Slack** (2026-09-08, 6 workspaces) |
| **Copy as Markdown** – a button in the message hover toolbar copies the message as GitHub-flavoured Markdown (`text/plain`) and as HTML (`text/html`) at the same time, so it pastes into Markdown editors as Markdown and back into Slack with its formatting. Shift+click adds a quoted source line (sender, time, channel, permalink). Forwarded messages copy as an attributed quote, and a button in the thread pane header copies the whole thread with one attribution line per reply | `app.slack.com` | Message, thread and forwarded-message copy **verified on live Slack** (2026-09-08) |
| **Noise removal** – hides trial / upgrade / hint banners by heuristic (banner-like class name + wording, so promotions Slack adds later are caught too), plus per-item toggles for rail tabs, shortcut hints, toolbar buttons and the unread banner | `app.slack.com` | Heuristic **verified on live Slack** (hides Slack's hint banner); trial and notification banners verified against the fixture |

Grouping, copy, noise removal and the workspace column are switched in the options page
(`chrome://extensions` → tabane → **Details** → **Extension options**). Open-in-browser and the
ChromeOS user agent are always on.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this directory

Requires Chrome 111 or later (`"world": "MAIN"` content scripts).

### Where to use it

This is an unreviewed extension that rewrites Slack's DOM. Loading it into a company workspace
may be a concern for your IT / audit team. The author uses it **only in personal workspaces**;
please make that call for your own organisation.

## How grouping works

- Channel names are split on `-` and `_`. A channel is grouped at depth *d* when the previous
  **or** next sidebar entry shares its first *d* segments.
- Rows render one `label + glyph` pair per grouped level, then the remaining name. The label is
  shown only on the first row of a group and kept invisible (but same width) on the rest, so the
  glyphs line up.
- A channel whose whole name is a prefix (`proj` next to `proj-dev`) becomes the root of the
  group and is shown as `proj┬/`.
- Direct messages, group DMs, section headers and buttons are never grouped, and they also
  break a group (an entry with no name separates the channels above and below it).
- Nesting depth (1–4) is set in the options page.
- Folding hides the group's other rows and shifts the rows below up with a `transform`,
  because Slack positions sidebar rows absolutely. The list keeps Slack's total height, so a
  folded sidebar has some empty space at the bottom. Folding works on the rows Slack has
  rendered; on a very long sidebar (hundreds of channels) rows far off-screen are not in the
  DOM and the shift may be off until they scroll into view.
- Grouping is positional: it only works when related channels sit next to each other, i.e.
  with the sidebar sorted alphabetically.

The grouping rules live in [`src/grouping.js`](src/grouping.js) as a pure function with no DOM
access, and are covered by [`test/grouping.test.js`](test/grouping.test.js).

## Slack DOM dependencies

Every Slack extension dies the same way: Slack changes its markup and nobody updates the
selectors. To keep that cheap, each content script keeps its selectors in one `SELECTORS`
block at the top of the file, the noise rules live in `NOISE_RULES` in
[`src/lib/noise.js`](src/lib/noise.js), and the workspace column is two rules in
[`src/workspace-switcher.css`](src/workspace-switcher.css).

| Key | Selector / attribute | Used for |
|---|---|---|
| `list` | `.p-channel_sidebar__static_list` | Container to observe; re-created on workspace switch |
| `items` | `[role="listitem"], [role="treeitem"]` | One entry per sidebar row |
| `channel` + `channelTypeAttr` | `.p-channel_sidebar__channel[data-qa-channel-sidebar-channel-type]` | `channel` / `private` / `im` / `mpim` |
| `name` | `.p-channel_sidebar__name` | Element whose text is the channel name |
| `nameKeyAttr` | `data-qa` on the name element | Rewritten by Slack when a virtual-list row is reused; used as a re-render trigger |
| `unreadClass` / `badge` | `.p-channel_sidebar__channel--unread`, `.p-channel_sidebar__badge` | Unread state and mention count, aggregated onto a folded row |
| (CSS) | `.p-workspace_switcher_prototype` | Container of the workspace column; `display: none` in the browser until opened as a popover |
| (CSS) | `.p-client_workspace_wrapper` | The rest of the client; shifted 60px right to sit beside the column |
| copy `message` / `actionsGroup` | `[data-qa="message_container"]`, `[data-qa="message-actions"]` | A message and its hover toolbar, where the copy button is inserted |
| copy `richText` | `.p-rich_text_block` with `data-stringify-*` attributes | Rendered message body; the attributes name bold/italic/code/pre/quote/list/emoji/mention |
| copy `sender` / `timestamp` | `[data-qa="message_sender_name"]`, `a.c-timestamp` (`href`, `data-ts`) | Source line for Shift+click |
| copy `attachment` / `forwardedCard` | `.c-message_attachment`, `[data-qa="forwarded_message_card"]` (`[class^="byline"]`, `[class^="context"]`) | Forwarded messages: quoted with author, date and context |
| copy `threadPane` / `threadHeader` | `[data-qa="threads_flexpane"]`, `.p-flexpane_header`, `[data-qa="secondary-header-more"]` | Thread pane; the copy-thread button goes before "more" |
| noise rules | `[data-qa="tab_rail_*_button"]`, `.p-tab_rail__shortcut_hint`, `.p-message_pane__unread_banner`, … | Fixed hide rules, see `NOISE_RULES` in `src/lib/noise.js` |
| noise heuristic | `[class*="banner"]`, `[class*="upsell"]`, `[class*="trial"]`, … + wording | Candidates for the trial / upsell / hint detection |

Assumption: Slack writes the channel name into `.p-channel_sidebar__name` as plain text
(`textContent`), so when it re-renders a row our spans are replaced and the observer sees it.

## Development

```
npm test                      # node --test, no dependencies
python3 -m http.server 8765   # then open http://localhost:8765/test/fixture/
python3 tools/make-icons.py   # regenerate icons (needs Pillow)
```

`test/fixture/index.html` is a fake Slack sidebar with buttons that simulate what Slack does
at runtime (row reuse, appending a channel, workspace switch, unread bold), for checking the DOM
layer without loading the extension.

## Roadmap

Candidate features and the reasoning behind them are in
[docs/feature-candidates.md](docs/feature-candidates.md) (Japanese).

- Verify open-in-browser in a browser profile where Slack has not yet remembered "open in browser"
- Verify group folding on live Slack
- Userscript build for Tampermonkey
- Chrome Web Store listing

## Credits

- [yamadashy/slack-channels-grouping](https://github.com/yamadashy/slack-channels-grouping) – the original one-level grouping and its DOM selectors
- [PR #149](https://github.com/yamadashy/slack-channels-grouping/pull/149) – the multi-level grouping proposal
- [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App)
- [leoluk/slack-workspace-sidebar](https://github.com/leoluk/slack-workspace-sidebar) and [Nevkontakte, "Workspace switcher bar for Slack in browser"](https://m.nevkontakte.com/articles/76e1af3/workspace-switcher-bar-for-slack-in-browser) – the ChromeOS user-agent trick. As of 2026-09 it is necessary but no longer sufficient: it makes Slack list every workspace, but the column stays hidden behind a popover, so tabane also unhides it with CSS

## License

[MIT](LICENSE)
