/**
 * Sessions (bulk) — a Hermes Desktop plugin by String Digital.
 * https://github.com/STRINGDigital/hermes-session-bulk  (MIT licence)
 *
 * Two tabs on one page, reached from the sidebar row "Sessions (bulk)":
 *
 *   Sessions       List, filter and multi-select sessions, then archive or
 *                  delete them in one go.
 *   Sidebar order  Reorder the sidebar rows under "New session": Default,
 *                  A → Z, Z → A, or Custom (drag and drop, or arrow buttons).
 *
 * SURFACES: ROUTES_AREA for the page, SIDEBAR_NAV_AREA for the row, and
 * SIDEBAR_NAV_PREFS_AREA for the order. The page is reachable at
 * #/session-bulk.
 *
 * GATEWAY CALLS:
 *   session.list   -> { sessions: [{ id, title, preview, started_at,
 *                                    message_count, source }] }
 *   session.delete -> requires { session_id }.
 *
 * ARCHIVE has no JSON-RPC method. The app archives over REST,
 * PATCH /api/sessions/<id> {archived:true}, through the desktop bridge
 * `window.hermesDesktop.api`. That bridge is not part of the plugin SDK, so it
 * is feature-detected: if it is missing, the Archive button disables itself
 * and says why, and delete keeps working.
 *
 * Deletion is irreversible, so its button arms on the first click and deletes
 * only on the second, naming the exact count both times. Archive is a
 * reversible soft-hide, so it fires on a single click.
 *
 * DATA: nothing leaves the machine. Sessions are read from the local gateway
 * while the page is open. The sidebar order and row labels are kept in this
 * plugin's own storage (ctx.storage).
 */

import { ROUTES_AREA, SIDEBAR_NAV_AREA, SIDEBAR_NAV_PREFS_AREA, host } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'session-bulk'
const PATH = '/session-bulk'

/* ---------------------------------------------------------------------------
 * SIDEBAR ORDER — the "Sidebar order" tab.
 *
 * Core already merges `sidebarNav.prefs` contributions into the nav list
 * (src/store/sidebar-nav.ts, applySidebarNavPrefs): the ids named in `order`
 * go first, every other row keeps its default place after them. Nothing ships
 * a UI for it; this tab is that UI. Because it is a contribution, disabling
 * this plugin drops it and the sidebar returns to the default order.
 *
 * Row discovery: the SDK exposes no list of nav rows, but each rendered row
 * carries `data-tour="sidebar-nav-<id>"` with its label as text. Rows hidden
 * by the interface mode are not rendered, so they are never dropped from the
 * stored order, only left out of the editor.
 *
 * "New session" stays pinned first; everything under it can move.
 * ------------------------------------------------------------------------- */

const PINNED = 'new-session'
const MODES = ['default', 'az', 'za', 'custom']
const MODE_LABEL = { default: 'Default', az: 'A → Z', za: 'Z → A', custom: 'Custom' }

const order = {
  ctx: null,
  dispose: null,
  listeners: new Set(),
  state: { mode: 'default', custom: [], labels: {} }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Rows on screen right now, in on-screen order, minus the pinned row. */
function discoverRows() {
  if (typeof document === 'undefined') return []
  const seen = new Set()
  const rows = []
  for (const el of document.querySelectorAll('[data-tour^="sidebar-nav-"]')) {
    const id = el.getAttribute('data-tour').slice('sidebar-nav-'.length)
    if (!id || id === PINNED || seen.has(id)) continue
    seen.add(id)
    rows.push({ id, label: (el.textContent || '').trim() || id })
  }
  return rows
}

function sortedIds(rows, labels, dir) {
  const label = id => labels[id] ?? id
  const ids = rows.map(r => r.id)
  ids.sort((a, b) => collator.compare(label(a), label(b)))
  return dir === 'za' ? ids.reverse() : ids
}

/** The ids to put first, given the mode. Empty = default order. */
function resolvedOrder(state, rows) {
  if (state.mode === 'az' || state.mode === 'za') {
    const known = new Set(rows.map(r => r.id))
    // Remembered rows not on screen (hidden by interface mode) still sort.
    const all = [...rows, ...Object.keys(state.labels).filter(id => !known.has(id) && id !== PINNED).map(id => ({ id }))]
    return sortedIds(all, state.labels, state.mode)
  }
  if (state.mode === 'custom') return state.custom.filter(id => id !== PINNED)
  return []
}

function applyOrder() {
  const { ctx } = order
  if (!ctx) return
  if (order.dispose) { order.dispose(); order.dispose = null }
  const ids = resolvedOrder(order.state, discoverRows())
  if (ids.length) {
    order.dispose = ctx.register({ id: 'nav-order', area: SIDEBAR_NAV_PREFS_AREA, data: { order: [PINNED, ...ids] } })
  }
}

function setOrderState(patch) {
  order.state = { ...order.state, ...patch }
  try { order.ctx?.storage.set('navOrder', order.state) } catch { /* storage optional */ }
  applyOrder()
  order.listeners.forEach(fn => fn(order.state))
}

/** Remember labels for every row on screen, so sorting works for rows that
 *  later go off screen and the editor can name them. */
function rememberLabels(rows) {
  const labels = { ...order.state.labels }
  let changed = false
  for (const r of rows) if (labels[r.id] !== r.label) { labels[r.id] = r.label; changed = true }
  if (changed) setOrderState({ labels })
}

function useOrderState() {
  const [state, setState] = useState(order.state)
  useEffect(() => {
    order.listeners.add(setState)
    return () => { order.listeners.delete(setState) }
  }, [])
  return state
}

function OrderTab() {
  const state = useOrderState()
  const [rows, setRows] = useState(() => discoverRows())
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  const rescan = useCallback(() => {
    const found = discoverRows()
    setRows(found)
    rememberLabels(found)
  }, [])

  useEffect(() => { rescan() }, [rescan])

  const labelOf = id => state.labels[id] ?? rows.find(r => r.id === id)?.label ?? id
  const onScreen = new Set(rows.map(r => r.id))

  // What the editor lists: the effective order, restricted to rows on screen.
  const listed = useMemo(() => {
    if (state.mode === 'default') return rows.map(r => r.id)
    const first = resolvedOrder(state, rows).filter(id => onScreen.has(id))
    const placed = new Set(first)
    return [...first, ...rows.map(r => r.id).filter(id => !placed.has(id))]
  }, [state, rows])

  /** Any manual move switches to Custom, starting from what is shown. Rows
   *  remembered but not on screen keep their stored place at the end. */
  const commit = nextListed => {
    const offScreen = state.custom.filter(id => !nextListed.includes(id))
    setOrderState({ mode: 'custom', custom: [...nextListed, ...offScreen] })
  }

  const move = (id, delta) => {
    const i = listed.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= listed.length) return
    const next = listed.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  const dropOn = targetId => {
    if (!dragId || dragId === targetId) return
    const next = listed.filter(id => id !== dragId)
    next.splice(next.indexOf(targetId), 0, dragId)
    commit(next)
  }

  const btn = 'rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.75rem] hover:bg-(--chrome-action-hover) disabled:opacity-40'
  const on = 'border-(--ui-text-primary) bg-(--chrome-action-hover) text-foreground'

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col gap-3',
    id: 'session-bulk-order',
    children: [
      jsx('p', {
        className: 'text-[0.75rem] text-(--ui-text-tertiary)',
        children: 'Order of the sidebar rows under “New session”. Changes apply to the sidebar immediately. Drag a row, or use the arrows; moving a row switches to Custom. Turning this plugin off restores the default order.'
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        role: 'radiogroup',
        'aria-label': 'Sidebar order',
        children: [
          ...MODES.map(m => jsx('button', {
            className: `${btn} ${state.mode === m ? on : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': state.mode === m,
            'data-mode': m,
            disabled: m === 'custom' && !state.custom.length && state.mode !== 'custom',
            title: m === 'custom' && !state.custom.length ? 'Drag a row to make a custom order' : undefined,
            onClick: () => setOrderState({ mode: m }),
            children: MODE_LABEL[m]
          }, m)),
          jsx('button', { className: `${btn} ml-auto`, type: 'button', onClick: rescan, children: 'Rescan rows' })
        ]
      }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-auto rounded border border-(--ui-stroke-tertiary)',
        children: !listed.length
          ? jsx('div', { className: 'p-4 text-(--ui-text-tertiary)', children: 'No sidebar rows found. Open the sidebar, then press Rescan rows.' })
          : jsxs('ol', {
              className: 'flex flex-col',
              children: [
                jsx('li', {
                  className: 'flex items-center gap-3 border-b border-(--ui-stroke-tertiary) px-3 py-2 text-(--ui-text-tertiary)',
                  children: 'New session (always first)'
                }, PINNED),
                ...listed.map((id, i) => jsxs('li', {
                  className: `flex items-center gap-3 border-b border-(--ui-stroke-tertiary) px-3 py-2 ${overId === id && dragId && dragId !== id ? 'bg-(--chrome-action-hover)' : ''} ${dragId === id ? 'opacity-40' : ''}`,
                  draggable: true,
                  'data-row-id': id,
                  onDragStart: e => { setDragId(id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) } catch {} },
                  onDragOver: e => { e.preventDefault(); if (overId !== id) setOverId(id) },
                  onDragLeave: () => setOverId(o => (o === id ? null : o)),
                  onDrop: e => { e.preventDefault(); dropOn(id); setDragId(null); setOverId(null) },
                  onDragEnd: () => { setDragId(null); setOverId(null) },
                  children: [
                    jsx('span', { className: 'cursor-grab select-none text-(--ui-text-tertiary)', 'aria-hidden': true, children: '⠿' }),
                    jsx('span', { className: 'w-6 text-right text-[0.6875rem] text-(--ui-text-tertiary)', children: String(i + 1) }),
                    jsx('span', { className: 'min-w-0 flex-1 truncate', children: labelOf(id) }),
                    jsx('button', { className: btn, type: 'button', 'aria-label': `Move ${labelOf(id)} up`, disabled: i === 0, onClick: () => move(id, -1), children: '↑' }),
                    jsx('button', { className: btn, type: 'button', 'aria-label': `Move ${labelOf(id)} down`, disabled: i === listed.length - 1, onClick: () => move(id, 1), children: '↓' })
                  ]
                }, id))
              ]
            })
      })
    ]
  })
}

function Shell() {
  const [tab, setTab] = useState('sessions')
  const tabBtn = active => `border-b-2 px-3 py-1.5 text-[0.8125rem] ${active ? 'border-(--ui-text-primary) text-foreground' : 'border-transparent text-(--ui-text-tertiary) hover:text-foreground'}`
  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-hidden p-6 text-sm',
    children: [
      jsxs('div', {
        className: 'flex gap-1 border-b border-(--ui-stroke-tertiary)',
        role: 'tablist',
        children: [
          jsx('button', { className: tabBtn(tab === 'sessions'), type: 'button', role: 'tab', 'aria-selected': tab === 'sessions', onClick: () => setTab('sessions'), children: 'Sessions' }),
          jsx('button', { className: tabBtn(tab === 'order'), type: 'button', role: 'tab', 'aria-selected': tab === 'order', 'data-tab': 'order', onClick: () => setTab('order'), children: 'Sidebar order' })
        ]
      }),
      tab === 'sessions' ? jsx(Page, {}) : jsx(OrderTab, {})
    ]
  })
}

const fmtDate = ts => {
  if (!ts) return ''
  try { return new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

function Page() {
  const [sessions, setSessions] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await host.request('session.list', {})
      const list = (res?.sessions ?? []).slice().sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
      setSessions(list)
      // Drop selections whose sessions no longer exist, so a stale id can never
      // be sent to session.delete after a refresh.
      setSelected(prev => new Set([...prev].filter(id => list.some(s => s.id === id))))
    } catch (err) {
      setError(String(err?.message ?? err))
      setSessions([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sessions ?? []
    return (sessions ?? []).filter(s =>
      (s.title ?? '').toLowerCase().includes(q) ||
      (s.preview ?? '').toLowerCase().includes(q) ||
      (s.id ?? '').toLowerCase().includes(q)
    )
  }, [sessions, filter])

  const toggle = id => {
    setArmed(false)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Select-all applies to what is VISIBLE, so a filtered view can't silently
  // select rows the user can't see and then delete them.
  const selectAllShown = () => { setArmed(false); setSelected(new Set(shown.map(s => s.id))) }
  const clearAll = () => { setArmed(false); setSelected(new Set()) }

  // Undocumented desktop bridge — see the header. Detected, never assumed.
  const canArchive = typeof window !== 'undefined' && typeof window.hermesDesktop?.api === 'function'

  const archiveSelected = async () => {
    if (!canArchive) return
    setBusy(true)
    setArmed(false)
    const ids = [...selected]
    let ok = 0
    const failed = []
    for (const id of ids) {
      try {
        await window.hermesDesktop.api({
          path: `/api/sessions/${encodeURIComponent(id)}`,
          method: 'PATCH',
          body: { archived: true }
        })
        ok++
      } catch (err) { failed.push(`${id}: ${String(err?.message ?? err).slice(0, 60)}`) }
    }
    setBusy(false)
    setSelected(new Set())
    await load()
    try {
      host.notify({
        kind: failed.length ? 'warning' : 'success',
        message: failed.length
          ? `Archived ${ok} of ${ids.length}; ${failed.length} failed`
          : `Archived ${ok} session${ok === 1 ? '' : 's'}`
      })
    } catch { /* toast optional */ }
    setError(failed.length ? failed.join('\n') : null)
  }

  const deleteSelected = async () => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    setArmed(false)
    const ids = [...selected]
    let ok = 0
    const failed = []
    for (const session_id of ids) {
      try { await host.request('session.delete', { session_id }); ok++ }
      catch (err) { failed.push(`${session_id}: ${String(err?.message ?? err).slice(0, 60)}`) }
    }
    setBusy(false)
    setSelected(new Set())
    await load()
    try {
      host.notify({
        kind: failed.length ? 'warning' : 'success',
        message: failed.length
          ? `Deleted ${ok} of ${ids.length}; ${failed.length} failed`
          : `Deleted ${ok} session${ok === 1 ? '' : 's'}`
      })
    } catch { /* toast optional */ }
    if (failed.length) setError(failed.join('\n'))
  }

  const btn = 'rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.75rem] hover:bg-(--chrome-action-hover) disabled:opacity-40'

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden',
    id: 'session-bulk-page',
    children: [
      jsxs('div', {
        className: 'flex items-baseline justify-between gap-3',
        children: [
          jsx('h1', { className: 'text-base font-medium', children: 'Sessions (bulk)' }),
          jsx('span', {
            className: 'text-[0.75rem] text-(--ui-text-tertiary)',
            children: sessions === null ? 'loading…' : `${selected.size} selected of ${shown.length} shown · ${sessions.length} total`
          })
        ]
      }),

      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        children: [
          jsx('input', {
            className: 'min-w-48 flex-1 rounded border border-(--ui-stroke-tertiary) bg-transparent px-2 py-1 text-[0.75rem]',
            placeholder: 'Filter by title, preview or id…',
            value: filter,
            onChange: e => setFilter(e.target.value)
          }),
          jsx('button', { className: btn, type: 'button', onClick: selectAllShown, disabled: busy || !shown.length, children: 'Select all shown' }),
          jsx('button', { className: btn, type: 'button', onClick: clearAll, disabled: busy || !selected.size, children: 'Deselect all' }),
          jsx('button', { className: btn, type: 'button', onClick: load, disabled: busy, children: 'Refresh' }),
          jsx('button', {
            className: btn,
            type: 'button',
            onClick: archiveSelected,
            disabled: busy || !selected.size || !canArchive,
            title: canArchive
              ? 'Archive hides sessions without deleting them (reversible)'
              : 'Unavailable: the desktop bridge window.hermesDesktop.api is missing on this build',
            children: canArchive ? `Archive selected (${selected.size})` : 'Archive unavailable'
          }),
          jsx('button', {
            className: `${btn} ${armed ? 'border-(--ui-text-danger) text-(--ui-text-danger)' : ''}`,
            type: 'button',
            onClick: deleteSelected,
            disabled: busy || !selected.size,
            children: busy
              ? 'Deleting…'
              : armed
                ? `Click again to delete ${selected.size}`
                : `Delete selected (${selected.size})`
          })
        ]
      }),

      error && jsx('pre', {
        className: 'max-h-24 overflow-auto rounded border border-(--ui-text-danger) p-2 text-[0.6875rem] text-(--ui-text-danger)',
        children: error
      }),

      jsx('div', {
        className: 'min-h-0 flex-1 overflow-auto rounded border border-(--ui-stroke-tertiary)',
        children: sessions === null
          ? jsx('div', { className: 'p-4 text-(--ui-text-tertiary)', children: 'Loading sessions…' })
          : !shown.length
            ? jsx('div', { className: 'p-4 text-(--ui-text-tertiary)', children: 'No sessions match.' })
            : jsx('div', {
                className: 'flex flex-col',
                children: shown.map(s =>
                  jsxs('label', {
                    className: 'flex cursor-pointer items-start gap-3 border-b border-(--ui-stroke-tertiary) px-3 py-2 hover:bg-(--chrome-action-hover)',
                    children: [
                      jsx('input', {
                        type: 'checkbox',
                        className: 'mt-0.5',
                        checked: selected.has(s.id),
                        onChange: () => toggle(s.id)
                      }),
                      jsxs('div', {
                        className: 'flex min-w-0 flex-1 flex-col',
                        children: [
                          jsx('div', { className: 'truncate', children: s.title || '(untitled)' }),
                          jsx('div', {
                            className: 'truncate text-[0.6875rem] text-(--ui-text-tertiary)',
                            children: `${fmtDate(s.started_at)} · ${s.message_count ?? 0} msg · ${s.source ?? '?'} · ${s.id}`
                          })
                        ]
                      })
                    ]
                  }, s.id)
                )
              })
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Sessions (bulk)',
  register(ctx) {
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: PATH }, render: () => jsx(Shell, {}) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: PATH, label: 'Sessions (bulk)', codicon: 'checklist' } })

    order.ctx = ctx
    order.dispose = null
    const saved = ctx.storage.get('navOrder', null)
    if (saved && typeof saved === 'object') {
      order.state = {
        mode: MODES.includes(saved.mode) ? saved.mode : 'default',
        custom: Array.isArray(saved.custom) ? saved.custom.filter(id => typeof id === 'string') : [],
        labels: saved.labels && typeof saved.labels === 'object' ? saved.labels : {}
      }
    }
    applyOrder()

    // A-Z / Z-A must re-sort when rows appear (sidebar mounting after load, a
    // plugin enabled later). Watch for the row set changing; re-apply only then.
    let lastKey = ''
    let timer = null
    const check = () => {
      timer = null
      const rows = discoverRows()
      const key = rows.map(r => `${r.id}=${r.label}`).sort().join('|')
      if (key === lastKey) return
      lastKey = key
      if (rows.length) rememberLabels(rows)
      if (order.state.mode === 'az' || order.state.mode === 'za') applyOrder()
    }
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      const mo = new MutationObserver(() => { if (!timer) timer = setTimeout(check, 250) })
      mo.observe(document.body, { childList: true, subtree: true })
      ctx.onDispose(() => { mo.disconnect(); if (timer) clearTimeout(timer) })
    }
    check()
    ctx.onDispose(() => { order.ctx = null; order.dispose = null })
  }
}
