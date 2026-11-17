# Area and shrink schedule: before and after

The implementation uses the existing React 18 / TypeScript / Vite stack,
Tailwind's shared controls, CSS custom properties, and Lucide icons. No packages
were added for this change. The app has a light theme; no dark theme was introduced.

## Markup

Before, the countdown was a text span above the map:

```tsx
<span>{remaining !== null
  ? `Next shrink in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  : 'Shrink timer has not started'}</span>
```

After, the panel starts with a separate accessible timeline component:

```tsx
<ShrinkTimeline
  data={data}
  stages={stages}
  now={Math.max(now, Date.now()) + offset}
  disabled={busy || dirty || status !== 'active'}
  onSeek={seconds => run(() => seekMapTimer(sessionId, seconds))}
/>
```

`ShrinkTimeline.tsx` contains an elapsed-time progress bar, scheduled tick marks,
a native range input with slider ARIA values, marker labels, and a drag tooltip.
The range retains native keyboard behavior; explicit pointer capture handles
mouse, pen, and touch dragging. Changes persist on release, key release, or blur;
pointer cancellation discards the preview. Failed requests restore server state
and use the existing error message.

The fill, handle and ticks share the same elapsed-time scale. The fill advances
with the handle while the text shows the decreasing time until the next shrink.
Time labels align beneath their tick marks. Dense schedules use a wrapping marker
legend to avoid overlapping labels on small screens.

Each scheduled marker also has a button: Shrink applies that stage's zone and
seeks to its scheduled time; Restore returns to the starting area at zero. These
use the same seek action as dragging and require a saved, running countdown.

Before, each stage used a plain legend and unadorned numeric inputs:

```tsx
<fieldset className="map-stage-row" disabled={locked || busy}>
  <legend>Shrink stage 2</legend>
  <label>After (minutes)<input className="field" ... /></label>
  <button className="btn-secondary" onClick={existingHandler}>Pick stage 2 center on map</button>
</fieldset>
```

After, it retains the semantic fieldset, original class names, accessible input
labels, handlers, values, validation limits, and collapsible coordinate sections:

```tsx
<fieldset className="map-stage-row" disabled={locked || busy}>
  <legend><span className="map-stage-badge">2</span>Shrink stage 2</legend>
  <label>After (minutes)
    <span className="map-input-unit">
      <input className="field" ... />
      <span aria-hidden="true">min</span>
    </span>
  </label>
  <button className="btn-secondary" onClick={existingHandler}>
    <MapPin size={16} aria-hidden="true" />Pick stage 2 center on map
  </button>
</fieldset>
```

## CSS

Before:

```css
.map-plan-editor .map-stage-row {
  margin: var(--space-6) 0 0;
  padding: var(--space-4);
  border: 1px dashed var(--color-line);
  border-radius: var(--radius-control);
}
```

After:

```css
.map-plan-editor .map-stage-row {
  --stage-accent: var(--color-ink);
  margin: var(--space-6) 0 0;
  padding: var(--space-4);
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--stage-accent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}
.map-plan-editor .map-stage-row:nth-of-type(3n + 2) {
  --stage-accent: var(--color-orange-text);
}
.map-plan-editor .map-stage-row:nth-of-type(3n) {
  --stage-accent: var(--color-muted);
}
```

The existing cream card, warm borders, display/body fonts, 8px spacing multiples,
control radii, 44px inputs, orange focus outlines, and readable disabled states
remain. Stage accents reuse existing theme colors. The timeline adds local
`--timeline-accent` and `--timeline-position` variables for its states and handle.
Fields and button rows stack below 480px. Unit suffixes do not change input values.

## Timer changes

- `POST /api/admin/sessions/{id}/map/seek` accepts an integer `elapsed_seconds`.
  Admin authorization is unchanged. Values outside the scheduled duration,
  stopped timers, inactive sessions, and plans without timed shrinks are rejected.
- Migration `20260101000024_map_timer_seek.sql` moves `map_started_at` and
  recomputes `map_stage_floor` in one transaction under the existing session lock.
  Rewinding can restore an earlier, larger area, as the interface explains.
- Seek reschedules the existing backend timer and broadcasts the updated snapshot.
  Player views continue to receive the same public map data; private plan and
  destination fields remain host-only.
- Manual Shrink jumps the clock to the next stage's time if the timer is running
  and that stage has a scheduled marker. Manual-only stages preserve the clock.
  Starting after a manual advance begins at that stage's scheduled marker.
- Reset still clears the timer and restores the starting area. The handle returns
  to zero. Start remains idempotent. Seeking requires a saved, active countdown.

The migration was tested on a disposable local PostgreSQL instance and applied
to the configured hosted Supabase database with user approval on 17 November
2026. The seek function, service-role-only permissions and API schema exposure
were verified. Existing game timers were not adjusted during deployment.

## Pause / Resume

Migration `20260101000025_map_timer_pause.sql` was applied to the configured
hosted Supabase database with user approval on 18 November 2026. The pause column,
service-role-only function permissions, and API schema exposure were verified.

The host's Pause button freezes the elapsed game clock without changing its
current zone. Resume shifts the start timestamp by the paused duration, preserving
the time remaining. Pause survives browser refresh and backend restart; player
countdowns show the paused state. Manual stage jumps and slider adjustments remain
available while paused and keep the timer paused. Reset clears pause state.

Local PostgreSQL checks covered repeated Pause/Resume, seeking and shrinking while
paused, and reset. Backend API/runtime tests passed. Browser checks passed on
desktop, phone Chromium, and iPhone WebKit, including refresh while paused.

## Visual comparison

- Before: [desktop](../frontend/artifacts/shrink-schedule-1440.png), [320px](../frontend/artifacts/shrink-schedule-320.png)
- After: [desktop](../frontend/artifacts/shrink-timeline-desktop.png), [phone](../frontend/artifacts/shrink-timeline-phone.png)

The before captures include the existing sticky host header. After captures hide
that header only for the screenshot so the entire card can be inspected.
