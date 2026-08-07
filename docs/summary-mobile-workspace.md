# Mobile Summary Workspace

Status: Approved on 2026-08-06

## Problem

On phones, the Summary and Video Chat content appeared before the Video, and
the Transcript appeared beneath both the Video and the potentially long active
panel. A Learner could need to scroll through the entire Summary before reaching
the Video or Transcript.

## Approved design

- The Video is the first page content beneath the app header on phones.
- The Video remains mounted while the Learner switches content panels.
- The Video uses the existing 16:9 presentation and mobile page gutter and
  scrolls away normally.
- Summary, Transcript, and Chat are equal tabs on phones. Summary is the default.
- Once the Video scrolls away, the tab rail pins beneath the app header.
- Only the active panel is visible.
- Tab selection is URL-backed. `?tab=transcript` and `?tab=chat` support direct
  links, refreshes, and browser history.
- A panel opens at its beginning on first selection. Returning to it restores
  its prior document position.
- Transcript uses normal document scrolling on phones. It keeps its contained
  scroller on larger screens.
- Before processing completes, Transcript remains selectable and explains that
  it will appear when processing finishes.
- Failed and cancelled Transcript states explain the outcome and provide the
  Summary retry path. Existing unavailable and not-requested explanations remain.
- Selecting a Timestamp Citation seeks and plays the Video, smoothly reveals it,
  and preserves the Learner's Transcript position.
- Chat remains unavailable until the Summary Run succeeds. A permanently locked
  `?tab=chat` deep link returns to Summary.
- Chat uses the available phone viewport beneath the pinned tabs, keeps messages
  internally scrollable, and leaves the composer accessible.
- Tablet and desktop layout remains unchanged: Summary and Chat stay in the main
  column, while Video and Transcript stay together in the secondary column.

## Verification seams

- Responsive content order and tab availability
- URL deep links, history updates, and permanent Video Chat lock handling
- Per-panel scroll restoration
- Transcript processing, failure, cancellation, unavailable, and completed states
- Timestamp seek, playback, and Video reveal
- Existing Summary Run, Video Chat, tablet, and desktop behavior
