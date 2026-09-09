# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` secondary-panel service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `secondaryPanel`, and `shell.overlay`. `secondaryPanel` is a session-scoped list whose entries own their complete chrome; `openPanel(id)` renders only that registered id, and `closePanel(id)` closes only its own active entry. The sidebar resize boundary is an invisible hit strip, while the secondary-panel boundary retains its floating pill; only the secondary panel shrinks during concession and then auto-closes visually. A closed sidebar retains a 56px control rail while the secondary column closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and secondary columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width with no active secondary panel, and it never reads or writes `localStorage`. The first panel open uses the 360px default; closing retains a dragged preference at or above 300px, while the rendered panel may use all viewport width above the 640px center floor. Opening another registered id replaces the active entry without changing that width. Hero and other unselected states derive a zero rendered secondary width without changing the active id or preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, returning to the same Session restores its active panel, and selecting a different Session closes it before paint. The conversation and secondary-panel owner shares are empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, `ILayout`, `LayoutPanelId`, and the owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and no active secondary panel; switching between distinct Session ids closes the active entry but retains its dragged width for the next panel, while unselected surfaces render the secondary column at zero width without modifying state.
- **Concession-chain auto-close derives a zero width without touching the preferred width or active id** — the panel restores itself when the window widens; consumers must not read the stored secondary width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
