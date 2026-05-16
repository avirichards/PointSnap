# Design Patterns Reference

Universal UX patterns derived from Apple's HIG philosophy, applicable to any platform.

## Table of Contents
1. [Navigation](#navigation)
2. [Onboarding](#onboarding)
3. [Modality](#modality)
4. [Searching](#searching)
5. [Entering Data](#entering-data)
6. [Feedback & Status](#feedback--status)
7. [Loading](#loading)
8. [Error Handling](#error-handling)
9. [Settings & Preferences](#settings--preferences)
10. [Notifications](#notifications)
11. [Managing Accounts](#managing-accounts)
12. [Offering Help](#offering-help)
13. [Launching & First Run](#launching--first-run)
14. [Undo & Redo](#undo--redo)
15. [Collaboration & Sharing](#collaboration--sharing)
16. [Drag & Drop](#drag--drop)
17. [File Management](#file-management)
18. [Full Screen & Focus Modes](#full-screen--focus-modes)
19. [Data Visualization](#data-visualization)
20. [Media Playback](#media-playback)
21. [Haptics & Physical Feedback](#haptics--physical-feedback)
22. [Ratings & Reviews](#ratings--reviews)
23. [Printing & Export](#printing--export)
24. [Empty States](#empty-states)
25. [Destructive Actions](#destructive-actions)

---

## Navigation

The user should always know where they are, where they can go, and how to get back.

### Principles
- Navigation should be **predictable** — consistent across the product
- The user should **never feel lost** — show their current location
- Support **going back** at every level — browser back, swipe back, breadcrumbs, back buttons
- Don't break the **back button** on web — it's the most-used navigation element

### Common Navigation Patterns
| Pattern | Best For | Platform Notes |
|---|---|---|
| **Tab bar** | 3-5 top-level sections | Bottom on mobile, top on web/desktop |
| **Sidebar** | Many sections, desktop/tablet | Collapsible on narrow viewports |
| **Navigation stack** | Hierarchical drill-down | Standard on mobile; breadcrumbs on web |
| **Breadcrumbs** | Deep hierarchies on web | Not common on mobile |
| **Bottom navigation** | Mobile primary nav | 3-5 items; avoid more |
| **Hamburger menu** | Space-constrained nav | Low discoverability — avoid if possible |
| **Top navigation bar** | Web primary nav | Horizontal links/dropdowns |

### Rules
- Navigation items should have **clear, concise labels** — icons alone are insufficient (add text labels)
- Each nav item should maintain its own **state/history** (e.g., tab memory)
- **Highlight the current section** clearly
- Don't mix navigation patterns unnecessarily — pick one primary pattern per level
- On mobile, keep primary navigation within **thumb reach** (bottom of screen)
- On web, critical navigation should be **visible without scrolling**
- Deep links should work — every meaningful view should have a URL (web) or deep link (mobile)

---

## Onboarding

Get users to value as fast as possible. The best onboarding is no onboarding.

### Principles
- Onboarding should be **fast, optional, and skippable**
- **Teach through interaction**, not walls of text
- Show **real content**, not placeholder demos
- Maximum **3-4 screens** if you must have walkthrough slides
- Request permissions **in context**, not all at once on first launch

### Patterns
- **Progressive disclosure** — reveal features as the user encounters them (best approach)
- **Contextual tips** — small hints near relevant UI when the user first encounters a feature
- **Interactive tutorials** — let users learn by doing the real task with guidance
- **Coach marks** — spotlight individual elements with brief explanations (use sparingly)
- **Welcome tour** — swipeable intro screens (worst approach — most users skip)

### Rules
- Let users **explore the app** before requiring sign-up or configuration
- Allow users to **revisit** tips and tutorials later
- Don't ask for **unnecessary information** upfront — collect it when it's needed
- First-time experience should feel **welcoming**, not like an interrogation
- Measure: if users skip your onboarding, it's probably not needed

---

## Modality

Modal experiences demand attention and require action before continuing. Use them sparingly.

### When to Use
- **Critical confirmations** — destructive actions, important decisions
- **Short, self-contained tasks** — compose message, edit details, quick configuration
- **Interruptions that need immediate attention** — session expiry, errors requiring action

### When NOT to Use
- Information that could be shown **inline**
- Tasks that require **navigating to other parts** of the app
- **Non-critical alerts** — use banners or toasts instead
- Anything the user didn't initiate (except genuine emergencies)

### Rules
- Always provide a **clear way to dismiss** (Cancel, Close, X, Done, or click outside)
- **Prevent data loss** on dismissal — warn if there are unsaved changes
- Present only **one modal at a time** — never stack modals (the "modal on modal" anti-pattern)
- Use the **least disruptive** modal style for the context:
  - **Dialog/Alert** — critical decisions, 2-3 button choices
  - **Sheet/Drawer** — tasks related to current context
  - **Full-screen modal** — immersive tasks (compose, edit, wizard)
  - **Toast/Snackbar** — brief, non-blocking confirmations
- Modals should be **focused** — one purpose, complete in 1-2 steps
- On mobile, bottom sheets are preferred over center dialogs (easier to reach)

---

## Searching

Help users find what they need quickly.

### Placement
- Search should be in a **consistent, expected location** — top of content areas, toolbar, or header
- On mobile: pull-down to reveal search, or persistent search bar at top
- On web: typically top-right of header or prominently in content area

### Behavior
- Show **suggestions and recent searches** as the user types
- Update results **as the user types** (search-as-you-type) when feasible
- Support **search scopes/filters** for refining results (e.g., "All", "Photos", "People")
- Preserve **search context** when navigating to a result and returning
- Show helpful **"no results" states** — suggest corrections, related terms, or actions

### Rules
- Provide a **clear button** (x) to reset search
- Support **voice search** on platforms that support it
- Remember and surface **recent searches**
- Show **result count** so users know the scope of matches
- Don't return irrelevant results to pad the list — quality over quantity

---

## Entering Data

Minimize manual input. Every field is friction.

### Principles
- Use **specialized input types**: pickers, toggles, dropdowns, date pickers, sliders — instead of free text when the input is constrained
- Show the **appropriate keyboard/input method** for the data type (email, phone, URL, number)
- Provide **smart defaults** to reduce input burden
- Validate **inline as the user types**, not only on submit
- Use **autofill and autocomplete** wherever applicable (addresses, credentials, payment)

### Rules
- Labels go **above or beside** fields — never rely only on placeholder text (it disappears on focus, is low contrast, and is inaccessible)
- Group **related fields** logically with visual proximity and section headers
- Mark **optional fields** (not required ones) — most fields should be required if they're shown at all
- Show **character counts** for fields with length limits
- Support **paste** — never block pasting into any field (especially passwords)
- Input fields should be **full width on mobile**, appropriately sized on desktop (match expected content length)
- Use **input masking** for formatted data (phone numbers, credit cards, dates)
- Preserve user input on errors — never clear the form after a failed submission

---

## Feedback & Status

Keep users informed about what's happening.

### Types of Feedback
| Type | When | How |
|---|---|---|
| **Success** | Action completed | Toast/snackbar, inline confirmation, checkmark |
| **Progress** | Action in progress | Progress bar (determinate) or spinner (indeterminate) |
| **Error** | Something went wrong | Inline error near the problem, banner, or dialog for critical errors |
| **Warning** | Potential issue | Inline warning, banner |
| **Info** | Contextual information | Inline text, tooltip, banner |

### Rules
- Use **non-modal feedback** whenever possible — banners, toasts, inline messages
- For **destructive actions**, require explicit confirmation before proceeding
- Determinate progress (progress bar) when you can estimate completion; indeterminate (spinner) when you can't
- Keep feedback **brief and actionable** — tell users what they can do, not just what went wrong
- Success feedback can be **brief and auto-dismiss** (2-4 seconds)
- Error feedback should **persist until acknowledged or resolved**
- Use **haptic feedback** on supported devices to confirm physical interactions
- Don't overuse feedback — constant notifications/toasts train users to ignore them

---

## Loading

The goal: finish before anyone notices. When that's not possible, make the wait feel shorter.

### Strategies (in order of preference)
1. **Preload and cache** — load data before the user needs it
2. **Skeleton screens** — show placeholder shapes that match content layout (better than spinners)
3. **Progressive loading** — show partial content immediately, fill in as data arrives
4. **Optimistic updates** — show the result immediately, sync in the background (for low-risk actions)
5. **Progress indicators** — determinate bar for known duration, spinner for unknown

### Rules
- Don't show **any indicator for <1 second** — it creates perceived slowness
- For 1-3 seconds, use a **spinner or skeleton**
- For 3+ seconds, use a **progress bar** with context ("Loading 3 of 10...")
- Never block the **entire UI** while loading one piece of content
- Cache aggressively for **repeat visits**
- Show **stale content** rather than a loading screen when you have cached data (update in background)
- Lazy load **below-the-fold** content

---

## Error Handling

Errors happen. How you handle them defines the user experience.

### Principles
- **Prevent errors** first — disable invalid actions, validate early, use constraints
- When errors occur, explain **what happened** and **what to do next**
- Show errors **near the source** — inline validation next to the field, not in a distant banner
- Use **plain language** — no error codes, stack traces, or jargon
- Never blame the user — "That email address isn't valid" not "You entered an invalid email"

### Error Message Format
```
[What happened] + [What to do]
"That password is too short. Use at least 8 characters."
"We couldn't save your changes. Check your connection and try again."
"That email is already registered. Sign in instead?"
```

### Rules
- Preserve **all user input** when displaying errors — never clear the form
- Allow **retry** without re-entering information
- For network errors, offer **offline functionality** or queue actions for later
- Log detailed errors for developers; show simple messages for users
- **404/empty states** should be helpful — suggest alternatives, not just "Not Found"

---

## Settings & Preferences

If your defaults are good enough, most users will never visit settings.

### Principles
- Provide **sensible defaults** — the product should work well out of the box
- Only surface settings that users **actually need to change**
- **Frequently changed** options belong in the main UI, not buried in settings
- **Infrequently changed** options belong in settings

### Rules
- Show the **current value** of each setting
- Group related settings logically with **section headers**
- Use appropriate controls: **toggles** for on/off, **radio/segmented** for mutual exclusion, **sliders** for ranges
- Changes should take effect **immediately** where possible (no "Save" button for individual toggles)
- On mobile, prefer **in-app settings** over OS-level settings (discoverability)
- Provide a way to **reset to defaults**
- Don't expose implementation details as settings ("Buffer size: ___")

---

## Notifications

A notification is a privilege, not a right. Abuse it and users will disable them.

### Principles
- Notifications must be **timely, important, and actionable**
- Never use notifications for **marketing or re-engagement** disguised as important updates
- Request permission **in context** — when the user does something that would benefit from notifications

### Rules
- Support **grouping** related notifications
- Provide **rich content** — images, action buttons, expanded views
- Respect **do not disturb** and focus modes
- Provide **in-app notification preferences** — let users control what they receive
- Use **silent/passive notifications** for low-priority updates
- Every notification type should have an **independent on/off toggle**
- Consider whether the information could be shown **in-app instead** — not everything needs a push

---

## Managing Accounts

### Principles
- Don't require an account to **explore the product** — show value first
- Delay account creation until it provides **clear value** to the user
- Make sign-up **as frictionless as possible** — social sign-in, magic links, passkeys

### Rules
- Support **"Sign in with Apple/Google"** and **passkeys** for frictionless auth
- Use **biometric authentication** where available (Face ID, Touch ID, Windows Hello)
- Store credentials securely (keychain, credential manager) — **never in plain text**
- Make **account deletion easy** and accessible (required by Apple App Store, GDPR)
- Don't require password + email verification + phone verification + captcha all at once
- Support **password managers** — never block paste in password fields
- Session management: keep users signed in on trusted devices; don't expire sessions unnecessarily

---

## Offering Help

### Principles
- Provide help **in context** — at the point where the user needs it
- Don't rely on a manual — integrate guidance into the experience
- Help should be **searchable** if substantial

### Patterns
- **Contextual tips** — small hints near features when first encountered (TipKit, tooltips)
- **Inline documentation** — brief explanations within the UI
- **Searchable help center** — for complex products
- **Chat support** — for products that need human assistance
- **Empty state guidance** — explain what to do when there's no content yet

### Rules
- Tips should be **dismissible** and **re-accessible**
- Don't interrupt the user's flow to show help — make it available but not forced
- Use progressive disclosure — brief explanation first, "Learn more" for details

---

## Launching & First Run

### Principles
- The product should be **ready to use immediately**
- Show **real content** on first load — not a loading screen, brand animation, or empty state
- Restore the user's **previous state** when returning

### Rules
- **No splash screens** — they add perceived latency and provide no value
- **No interstitials** before content — no "What's New" modals, no forced tutorials
- First launch should feel **fast and welcoming**
- If loading is required, use a **skeleton screen** that mirrors the real layout
- Don't ask users to configure, sign in, or choose preferences before showing any value
- Web: initial meaningful paint should happen in **<2 seconds**

---

## Undo & Redo

### Principles
- Support undo/redo for **all significant, reversible actions**
- Users should feel safe to **explore and experiment** knowing they can reverse mistakes

### Rules
- Support **Cmd/Ctrl+Z** (undo) and **Cmd/Ctrl+Shift+Z** (redo)
- On mobile, support **shake to undo** (iOS) or provide an undo affordance (e.g., toast with "Undo" button)
- Show **confirmation before destructive actions** that can't be undone
- Offer **undo in success feedback** — "Message sent. Undo" (with a time window)
- Maintain a reasonable **undo stack depth**
- Make undo available **immediately** after an action — don't force navigation to undo

---

## Collaboration & Sharing

### Principles
- Make sharing **simple** — use platform-native share mechanisms (Web Share API, system share sheets)
- Show **who's viewing/editing** in collaborative contexts
- Handle **conflicts gracefully** — show clear merge/conflict UI

### Rules
- Use the system share sheet/dialog — don't build fully custom sharing flows
- Support **copying a link** as a sharing option (the simplest and most universal)
- Don't add your branding to shared content without user consent
- Show **real-time collaboration indicators** (cursors, presence dots, edit highlights)
- Auto-save collaboratively edited content

---

## Drag & Drop

### Principles
- Provide **visual feedback** throughout: lift on pickup, drop target highlighting, cursor changes
- Support **undo** for drag operations

### Rules
- Show a **clear drop indicator** showing where the item will land
- Spring-load drop targets — hovering over a folder/tab should open it
- Support multi-item drag where it makes sense
- On web, use the native Drag and Drop API for cross-app interop
- Provide **alternative methods** for the same action (keyboard, context menu) — drag is not accessible to all users

---

## File Management

### Rules
- Support standard operations: create, rename, duplicate, move, delete
- **Auto-save** — users shouldn't worry about losing work
- Show save status clearly ("All changes saved", "Saving...")
- Use system file pickers for opening/saving files
- Support **undo for deletion** (trash/recycle bin pattern, not permanent delete)

---

## Full Screen & Focus Modes

### Rules
- Full screen is for **focused, immersive** experiences (video, reading, presentations, editing)
- Always provide a clear way to **exit** (Esc key, visible exit button on hover/tap)
- Auto-hide chrome in full screen but reveal on interaction (mouse move, tap)
- Don't force full screen unless the experience genuinely requires it
- Support keyboard shortcut (F11, Cmd+Ctrl+F, etc.) for full-screen toggle

---

## Data Visualization

### Rules
- Choose chart type based on data relationship: **bar** (comparison), **line** (trends), **area** (volume), **pie/donut** (proportion — use sparingly)
- **Label axes** clearly with units
- Avoid **3D effects** — they distort perception of values
- Use **consistent color coding** across related charts
- Provide **accessible descriptions** for screen readers
- Show appropriate detail — don't overwhelm with data points
- Interactive charts should show **data on hover/focus** (tooltips)
- Provide a **data table alternative** for accessibility

---

## Media Playback

### Rules
- Support **standard controls**: play/pause, scrub/seek, volume, full-screen
- Respect **aspect ratio** — never stretch or distort media
- Support **picture-in-picture** where available
- Support **external display/casting** (AirPlay, Chromecast)
- Handle **audio interruptions** gracefully (incoming calls, other audio sources)
- Auto-play should be **muted** by default (web best practice and browser requirement)
- Show **buffering/loading states** for streaming content
- Remember **playback position** for resuming later

---

## Haptics & Physical Feedback

For platforms that support haptic feedback (mobile, game controllers, wearables):

### Rules
- Use haptics to provide **physical confirmation** of interactions
- Use **system haptic patterns** for standard feedback: success, warning, error, selection change
- Don't overuse — constant vibration trains users to ignore it
- Pair haptics with **visual and audio** feedback for accessibility
- Respect the user's haptic/vibration settings

---

## Ratings & Reviews

### Rules
- Use the **platform's standard rating prompt** (SKStoreReviewController on iOS, In-App Review API on Android)
- Ask **after a positive engagement**, never on first launch or during frustration
- Don't build custom rating prompts that circumvent platform limits
- Don't interrupt tasks to ask for ratings
- Don't offer **incentives for reviews**
- Limit frequency — respect the platform's prompt limits (e.g., 3x/year on iOS)

---

## Printing & Export

### Rules
- Use the **system print dialog** — don't build a custom one
- Provide sensible **paper size and orientation** defaults
- Offer **PDF/CSV/image export** as alternatives to printing
- Print output should be **clean** — no navigation, no ads, no unnecessary UI

---

## Empty States

When there's no content to show, the empty state IS the design.

### Rules
- Never show a **blank screen** — always explain what goes here and how to fill it
- Include a **clear call to action** — "Create your first project", "Import data", etc.
- Use illustration or iconography to make empty states **feel intentional**, not broken
- Empty states are a great place for **contextual onboarding**
- Differentiate between "no content yet" (first use) and "no results" (search/filter) — the messaging is different

---

## Destructive Actions

### Rules
- **Require explicit confirmation** — "Delete this project? This can't be undone."
- Use **specific language** in confirmation: "Delete Project" not "OK"
- Style destructive buttons in **red/danger color** and place them in a consistent position
- Provide **undo** when possible (soft delete > hard delete)
- Don't place destructive actions next to constructive ones without visual separation
- Consider a **cooling-off period** for high-stakes deletions (e.g., "Account will be deleted in 30 days")
- Show **what will be affected** — "This will also delete 47 files and 3 collaborators' access"
