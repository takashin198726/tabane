# tabane

A minimal MV3 Chrome extension that **bundles Slack sidebar channels into a multi-level tree**
by their name prefix, plus two small quality-of-life fixes for using Slack in the browser.

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
| **Sidebar grouping** – nested tree by `-` / `_` prefixes, up to 3 levels | `app.slack.com` | **Verified on live Slack** (2026-09-08) and against the fixture in `test/fixture/` |
| **Open in browser** – follows the "use Slack in your browser" link instead of waiting for the desktop app | `*.slack.com/archives/*`, `*.slack.com/ssb/redirect*` | Ported from [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App); not yet verified |
| **Workspace switcher** – keeps Slack's own workspace column (one icon per signed-in workspace) always visible instead of hidden behind a popover | `app.slack.com` | **Verified on live Slack** (2026-09-08) |

All three are always on. Per-feature toggles are on the roadmap.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this directory

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
- Nesting stops at 3 levels (`MAX_DEPTH` in `src/sidebar-grouping.js`).
- Grouping is positional: it only works when related channels sit next to each other, i.e.
  with the sidebar sorted alphabetically.

The grouping rules live in [`src/grouping.js`](src/grouping.js) as a pure function with no DOM
access, and are covered by [`test/grouping.test.js`](test/grouping.test.js).

## Slack DOM dependencies

Every Slack extension dies the same way: Slack changes its markup and nobody updates the
selectors. To keep that cheap, every selector is in one block, `SELECTORS`, at the top of
[`src/sidebar-grouping.js`](src/sidebar-grouping.js), plus one rule in
[`src/workspace-switcher.css`](src/workspace-switcher.css).

| Key | Selector / attribute | Used for |
|---|---|---|
| `list` | `.p-channel_sidebar__static_list` | Container to observe; re-created on workspace switch |
| `items` | `[role="listitem"], [role="treeitem"]` | One entry per sidebar row |
| `channel` + `channelTypeAttr` | `.p-channel_sidebar__channel[data-qa-channel-sidebar-channel-type]` | `channel` / `private` / `im` / `mpim` |
| `name` | `.p-channel_sidebar__name` | Element whose text is the channel name |
| `nameKeyAttr` | `data-qa` on the name element | Rewritten by Slack when a virtual-list row is reused; used as a re-render trigger |
| (CSS) | `.p-workspace_switcher_prototype` | Container of the workspace column; `display: none` in the browser until opened as a popover |

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

- Verify open-in-browser in a browser profile where Slack has not yet remembered "open in browser"
- Per-feature on/off toggles (options page)
- Userscript build for Tampermonkey
- Chrome Web Store listing

## Credits

- [yamadashy/slack-channels-grouping](https://github.com/yamadashy/slack-channels-grouping) – the original one-level grouping and its DOM selectors
- [PR #149](https://github.com/yamadashy/slack-channels-grouping/pull/149) – the multi-level grouping proposal
- [yumebayashi/Open-Slack-in-Browser-not-App](https://github.com/yumebayashi/Open-Slack-in-Browser-not-App)
- [leoluk/slack-workspace-sidebar](https://github.com/leoluk/slack-workspace-sidebar) and [Nevkontakte, "Workspace switcher bar for Slack in browser"](https://m.nevkontakte.com/articles/76e1af3/workspace-switcher-bar-for-slack-in-browser) – the ChromeOS user-agent trick. As of 2026-09 it no longer has any effect: Slack renders the column for every browser but hides it behind a popover, so tabane unhides it with CSS instead

## License

[MIT](LICENSE)
