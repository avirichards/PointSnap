# UI Components Reference

Universal UI component guidance derived from Apple's HIG philosophy, applicable to any platform.

## Table of Contents
1. [Buttons](#buttons)
2. [Links](#links)
3. [Text Fields & Inputs](#text-fields--inputs)
4. [Toggles & Switches](#toggles--switches)
5. [Checkboxes & Radios](#checkboxes--radios)
6. [Dropdowns & Select Menus](#dropdowns--select-menus)
7. [Segmented Controls](#segmented-controls)
8. [Sliders](#sliders)
9. [Steppers](#steppers)
10. [Pickers (Date, Time, Color)](#pickers)
11. [Search Fields](#search-fields)
12. [Navigation Bars](#navigation-bars)
13. [Tab Bars & Tabs](#tab-bars--tabs)
14. [Sidebars](#sidebars)
15. [Breadcrumbs](#breadcrumbs)
16. [Toolbars](#toolbars)
17. [Menus & Context Menus](#menus--context-menus)
18. [Dialogs & Alerts](#dialogs--alerts)
19. [Sheets & Drawers](#sheets--drawers)
20. [Popovers & Tooltips](#popovers--tooltips)
21. [Toasts & Snackbars](#toasts--snackbars)
22. [Banners](#banners)
23. [Cards](#cards)
24. [Lists & Tables](#lists--tables)
25. [Scroll Views](#scroll-views)
26. [Page Controls & Pagination](#page-controls--pagination)
27. [Progress Indicators](#progress-indicators)
28. [Badges & Tags](#badges--tags)
29. [Avatars & User Indicators](#avatars--user-indicators)
30. [Charts & Data Visualization](#charts--data-visualization)
31. [Image Views](#image-views)
32. [Text Views & Rich Text](#text-views--rich-text)
33. [Forms](#forms)
34. [Accordion & Disclosure](#accordion--disclosure)
35. [Skeletons & Placeholders](#skeletons--placeholders)

---

## Buttons

The primary interactive element — triggers an action when activated.

### Hierarchy
Use visual weight to communicate importance:
1. **Primary/Filled** — main call to action; one per view/section
2. **Secondary/Tinted** — important but not the main action
3. **Tertiary/Outlined** — less prominent alternative actions
4. **Ghost/Plain** — minimal style for low-emphasis actions

### Rules
- Use **descriptive labels** — "Save Photo" not "Submit", "Delete Account" not "OK"
- Include an **accessible name** even for icon-only buttons
- Show clear **state changes**: hover, focus, active, disabled, loading
- Disabled buttons should explain **why** (tooltip or nearby text) — don't leave users guessing
- **Don't use buttons for navigation** — use links for going to a new page/view
- Loading state: replace label with spinner + "Saving..." — don't let users click twice
- Minimum size: **44x44px** (touch), **24x24px** (pointer)
- Group related buttons with consistent spacing; align primary to the trailing/right side (for LTR)

### Destructive Buttons
- Style in **red/danger color**
- Place in a consistent position (leading/left side of button group, or separated)
- Require **confirmation** for irreversible actions

---

## Links

Navigate to a new page, view, or resource.

### Rules
- Links go to **destinations**; buttons perform **actions** — don't confuse them
- Use **descriptive link text** — "View pricing details" not "Click here" or "Learn more"
- Links should be **visually distinct** from body text (color + underline)
- Underline links in body text — it's the most universally recognized affordance
- Visited links should change color (web convention)
- Don't use links for actions that modify data — use buttons
- **Never open links in new tabs/windows** unless the user is in the middle of a task (form, checkout) that would be lost

---

## Text Fields & Inputs

Single or multi-line text input.

### Rules
- Always show a **visible label** — don't rely on placeholder text alone
- Use the correct **input type/keyboard**: email, URL, phone, number, password
- Show a **clear button** (x) for easy reset
- Support **autofill and autocomplete** — never block paste
- Validate **inline** with error messages below the field
- Error messages should be **specific**: "Email must include @" not "Invalid input"
- Size the field to match expected input length (don't use a full-width field for a 5-digit zip code)
- Show **character count** when there's a maximum length
- **Multi-line fields** (textareas) should be resizable or auto-expanding
- Support **undo** (Cmd/Ctrl+Z) in all text fields

---

## Toggles & Switches

Binary on/off control that takes **immediate effect**.

### Rules
- Toggles are for **state**, not actions — they enable/disable something
- The change should be **immediate** — no save button needed
- Label describes what happens when the toggle is **ON**
- Show the current state clearly — visual position and optionally an "On/Off" label
- Don't use toggles for mutually exclusive options with more than 2 choices — use radio buttons or a segmented control
- Minimum size: same as button targets (44x44px touch)

---

## Checkboxes & Radios

### Checkboxes
- For **independent, non-exclusive** options — user can select zero, one, or many
- Support **indeterminate state** for "select all" parents with mixed children
- Each checkbox needs its own **visible label** — the label should be clickable too

### Radio Buttons
- For **mutually exclusive** options in a visible group (2-7 options)
- One must always be selected (provide a sensible default)
- Radio groups need a **group label** explaining what the choice is about
- Use radios when you want all options **visible simultaneously**
- For many options (7+), use a dropdown instead

---

## Dropdowns & Select Menus

Select one option from a list that is hidden until activated.

### Rules
- Show the **current selection** on the trigger
- Use when there are **5+ options** that don't need to be visible simultaneously
- For fewer options, prefer segmented controls or radio buttons
- Include a **placeholder/prompt** ("Select a country...")
- Support **type-ahead filtering** for long lists (20+ options)
- Group options with **section headers** when categories exist
- Keep the list **scrollable** — don't let it overflow the viewport
- On mobile, prefer **native pickers** for dates, times, and short lists

---

## Segmented Controls

Switch between **2-5 mutually exclusive** views or filters.

### Rules
- All options are **visible simultaneously** — that's the point
- Use for **view switching** (Day/Week/Month) or **filtering** (All/Active/Completed)
- Keep labels short — **1-2 words** each
- Don't use for actions — only for selecting a state or view
- One segment should always be selected (show the default)
- For more than 5 options, use tabs or a dropdown

---

## Sliders

Select a value from a **continuous range** by dragging.

### Rules
- Provide **min/max labels** or icons
- Use for settings where **precision isn't critical** (volume, brightness, opacity)
- For precise numeric input, offer a **text field alternative** or companion
- Show the **current value** near the slider
- The track should indicate the selected range visually (filled portion)
- Consider **step snapping** for values that should be discrete (0, 25, 50, 75, 100)
- Minimum **44px drag target height** on touch devices

---

## Steppers

Increment or decrement a numeric value in **fixed steps**.

### Rules
- Always show the **current value** between or adjacent to the +/- buttons
- Use for **small numeric ranges** (quantity selectors, 1-10 items)
- For large ranges, use a text field or slider instead
- Support **long press to rapid-increment**
- Disable buttons at min/max values

---

## Pickers

Specialized selectors for dates, times, colors, and other constrained values.

### Rules
- Use **platform-native pickers** when available — they're familiar and accessible
- Date pickers: support **calendar view** and **text input** as alternatives
- Time pickers: match the user's **12h/24h preference**
- Color pickers: include **common preset swatches** alongside free selection
- Show the **selected value** clearly outside the picker
- On mobile, pickers often work best as **bottom sheets**

---

## Search Fields

### Rules
- Place in a **consistent, expected location** (top of lists, header, toolbar)
- Show **placeholder text** indicating what can be searched
- Provide **recent searches** and **suggestions** as the user types
- Show a **clear button** (x) to reset
- Support **keyboard shortcut** to focus search (Cmd/Ctrl+K or / is common on web)
- Update results **as the user types** when feasible
- Support **search scopes/filters** for narrowing results
- Show **"no results" state** with helpful suggestions

---

## Navigation Bars

Top bar providing title, back navigation, and key actions.

### Rules
- Show the **current view title**
- Provide a **back button** with the previous view's title (mobile) or breadcrumbs (web)
- Place **1-2 key actions** on the trailing/right side (not more)
- Support scrolling behavior: **large title → small title** or **hide on scroll down, show on scroll up**
- Navigation bar should be **sticky/fixed** at the top
- On web, consider whether the nav bar should be **opaque or translucent**

---

## Tab Bars & Tabs

### Tab Bar (Primary Navigation)
- For switching between **top-level sections** of a product
- **3-5 tabs** ideal; avoid more than 5 (use "More" sparingly)
- Position at **bottom** on mobile, **top** on web/desktop
- Each tab has an **icon AND label** — never icon-only (accessibility)
- Each tab maintains its own **navigation state** (tab memory)
- Don't use tabs for actions — they're for **destinations**
- Highlight the **active tab** clearly

### Content Tabs
- For switching between **views within a section** (different data views, settings categories)
- Position at the **top of content** area
- Can be scrollable if more than ~5 tabs
- Content below should change; the tab bar itself should not scroll away

---

## Sidebars

Vertical navigation panel, typically on the left.

### Rules
- Standard on **desktop and tablet**; collapsible on mobile
- Show **top-level categories** with icons and labels
- Support **collapsing** to icon-only or fully hidden on narrow viewports
- Support **keyboard navigation**
- Highlight the **active section**
- Limit nesting to **1-2 levels** deep
- Consider a **disclosure triangle** for expandable sections

---

## Breadcrumbs

Show the user's location in a hierarchy.

### Rules
- Used primarily on **web and desktop** — not common on mobile
- Each segment is **clickable** to navigate to that level
- Current page is the **last item** and should not be a link
- Use a **separator** between levels (>, /, or chevron)
- Don't use breadcrumbs as the only back-navigation method

---

## Toolbars

Display frequently used **commands and actions**.

### Rules
- Position at the **top** (desktop/web) or **bottom** (mobile) of the content area
- Use **icons with labels** for clarity; icon-only is acceptable if universally understood
- Keep to **essential actions** — don't overcrowd
- Support **overflow menu** for additional actions that don't fit
- Allow **customization** on desktop (rearrange, add/remove items)
- Toolbar should be **contextual** — show relevant actions for the current selection/mode

---

## Menus & Context Menus

### Menus
- Present a list of **actions or options** triggered by a button
- Organize with **section separators**
- Show **keyboard shortcuts** alongside actions (desktop)
- Dim unavailable items — **don't hide them** (users need to know the action exists)
- Destructive items go **last**, styled in red

### Context Menus
- Triggered by **right-click** (desktop) or **long-press** (mobile)
- Show actions relevant to the **specific item** under the cursor
- Include a **preview** of the item on mobile (iOS pattern)
- Don't put essential actions **only** in context menus — they're a power-user feature with low discoverability

---

## Dialogs & Alerts

For **critical information** requiring acknowledgment or a decision.

### Rules
- Keep the message **short and clear** — title + 1-2 sentences
- Use **2 buttons** most of the time; maximum 3
- Button labels should be **specific actions**: "Delete Photo", "Save Changes" — not "Yes/No/OK"
- Default/primary action on the **trailing/right** side (LTR)
- Destructive action styled in **red/danger** color
- Don't use dialogs for **non-critical information** — use toasts, banners, or inline messages
- Dialogs should be **dismissible** — at least with Esc key and a close button
- Block interaction with the background (modal scrim/overlay)

---

## Sheets & Drawers

Slide-up (mobile) or slide-in (desktop) panels for **focused tasks**.

### Rules
- Use for tasks **related to the current context** — editing details, composing, filtering
- Include a **close/done button** at the top
- Support **drag to resize** on mobile (half-screen, full-screen detents)
- Include a **grabber handle** on mobile for drag-to-dismiss affordance
- Prevent data loss — **warn before dismissing** if there are unsaved changes
- Preferred over dialogs for tasks that require **more than a simple choice**
- On mobile, bottom sheets are **easier to reach** than center dialogs

---

## Popovers & Tooltips

### Popovers
- Floating content anchored to a control — for **supplementary information or actions**
- Include an **arrow/caret** pointing to the source
- Dismiss by clicking outside
- On mobile, popovers often **adapt to sheets** (better for touch)
- Don't use for critical choices — use dialogs

### Tooltips
- Brief text that appears on **hover/long-press** — explains what a control does
- Show after a **short delay** (300-500ms hover)
- Keep to **one line** — if you need more, use a popover or inline help
- Never put essential information only in tooltips — they're inaccessible on touch devices
- Tooltips should describe the control's **action**, not repeat its label

---

## Toasts & Snackbars

Brief, non-blocking feedback messages.

### Rules
- Auto-dismiss after **2-5 seconds**
- Position at the **bottom** of the viewport (most common) or **top**
- Include a **single action** when appropriate ("Undo", "View", "Retry")
- Don't stack multiple toasts — queue them or replace the current one
- Don't use for critical errors — they auto-dismiss and may be missed
- Should be **non-blocking** — don't cover important content or controls
- Support **swipe to dismiss**

---

## Banners

Persistent messages at the top of a page or section.

### Rules
- Use for **important but non-blocking** information: warnings, system status, feature announcements
- Color-code by **severity**: info (blue), success (green), warning (yellow/orange), error (red)
- Include a **dismiss button** (unless the condition must persist)
- Include a **relevant action** when applicable ("Update now", "Fix this")
- Don't stack many banners — prioritize the most important one
- Position at the **top of the content area**, below the navigation

---

## Cards

Contained, elevated surfaces grouping related content.

### Rules
- Cards are for **scannable, browsable content** — news articles, products, profiles
- Each card should be a **self-contained unit** of information
- Interactive cards should have a **clear clickable area** — the whole card, or specific action buttons
- Consistent card size within a grid or list
- Include **essential information** on the card face — title, image, key metadata
- Don't overload cards — save details for the detail view
- Cards should have **subtle elevation** (shadow or border) to distinguish from background

---

## Lists & Tables

### Lists
- Display **rows of content** in a single scrollable column
- Support **swipe actions** on mobile (delete, archive, pin)
- Use **sections with headers** to organize long lists
- Support **pull to refresh** for dynamic content
- Show **loading states** at the bottom when loading more items (infinite scroll)
- Support **reordering** (drag handles) when order is user-controlled

### Tables (Data Tables)
- For **structured data** with multiple columns
- Support **column sorting** (click header to sort)
- Support **column resizing** and **reordering** on desktop
- Provide **row selection** (checkbox column) for batch actions
- Keep tables **scrollable horizontally** on mobile rather than hiding columns
- Use **zebra striping** or row dividers for readability
- Fixed headers when scrolling vertically

---

## Scroll Views

### Rules
- Support **vertical scrolling** by default; horizontal only for specific content (galleries, carousels, timelines)
- Show **scroll indicators** to communicate scrollable area
- Support **momentum scrolling** (rubber band/bounce at edges)
- Support **snap points** for discrete content items (carousels)
- Support **pull to refresh** on mobile for dynamic content
- Don't **hijack scroll behavior** on web (scroll jacking) — it disorients users
- Infinite scroll should show a **loading indicator** and ideally offer a "Load more" button as fallback

---

## Page Controls & Pagination

### Page Dots
- Show the **current page** in a horizontally swipeable set
- Use for **flat, peer content** (onboarding, photo gallery)
- Don't use for more than **~10 pages** — dots become meaningless
- Current dot should be **visually distinct** (larger, different color)

### Page Pagination
- Use **numbered pages** for search results, data tables, long lists
- Show: first, last, current, and **2-3 surrounding** page numbers
- Provide **previous/next** buttons
- Show **total count** and current range ("Showing 11-20 of 156")

---

## Progress Indicators

### Determinate (Progress Bar/Ring)
- When you know the **completion percentage**
- Label with context: "Downloading... 3 of 10 files" or "67%"
- Fill direction should match the reading direction (left to right for LTR)

### Indeterminate (Spinner)
- When **duration is unknown**
- Use the platform's native spinner/activity indicator
- Add a **text label** for anything that takes more than 2-3 seconds

### Rules
- Don't show any indicator for operations **under 1 second**
- Progress should **never go backwards** — it destroys trust
- For multi-step processes, consider a **step indicator** (Step 2 of 5)

---

## Badges & Tags

### Badges
- Small indicators on icons or tabs showing **unread counts or status**
- Keep numbers small — "99+" is the common cap
- Use sparingly — too many badges create noise

### Tags/Chips
- Small labeled elements for **categories, filters, or attributes**
- Support **dismissible** tags (x to remove) for user-applied filters
- Support **selectable** tags for filter selection
- Use consistent colors/shapes within a tag system

---

## Avatars & User Indicators

### Rules
- Show **user photos** in circles or rounded squares
- Provide a **fallback** for missing photos: initials, generic icon
- Show **online/offline status** with a small colored dot if relevant
- Size appropriately: small (24-32px) in lists, medium (40-48px) in headers, large (64-128px) in profiles
- Group overlapping avatars for **multi-user contexts** ("+3 others")

---

## Charts & Data Visualization

### Rules
- Choose the right type: **bar** (comparison), **line** (trends), **donut** (proportion), **area** (volume)
- **Label axes** clearly with units
- **Avoid 3D** — it distorts perception
- Provide **screen reader descriptions** and a **data table alternative**
- Interactive: show **data on hover/focus** (tooltips)
- Use **consistent colors** across related charts
- Don't overload — show the right level of detail for the context

---

## Image Views

### Rules
- Display images with proper **aspect ratio** (use object-fit: cover or contain, never stretch)
- Provide **alt text** for meaningful images
- Use lazy loading for images **below the fold**
- Show **loading placeholders** (blurred preview, skeleton, or background color)
- Support **zoom/lightbox** for detail viewing
- Handle broken images with a **graceful fallback**

---

## Text Views & Rich Text

### Rules
- Support **text selection** for copyable content
- Enable **data detectors** for links, emails, phone numbers, addresses (make them interactive)
- Support **Dynamic Type / text scaling**
- Use proper text styles (heading, body, caption) — not raw font sizes
- Long-form text needs **appropriate line length** (45-75 characters) and **line height** (1.4-1.6x)

---

## Forms

### Rules
- **One column layout** for forms — multi-column forms increase error rates
- Group related fields with **section headers and spacing**
- Place labels **above fields** (most scalable and accessible approach)
- Mark **optional fields** — not required ones (assume most fields are required)
- Show validation **inline and in real-time** — don't wait for submit
- Preserve all input on errors — **never clear the form**
- The submit button label should describe the **action**: "Create Account", "Place Order"
- Disable the submit button while submitting and show a **loading state**
- After successful submission, navigate to a **confirmation or next step** — don't stay on the form

---

## Accordion & Disclosure

### Rules
- Use to manage **information density** — show summaries with expandable details
- Clearly indicate **expanded/collapsed state** with a chevron or +/- icon
- Support **keyboard activation** (Enter/Space to toggle)
- Consider whether content should be **open by default** or closed
- Don't nest accordions deeply — it becomes confusing
- Allow **multiple sections open** simultaneously (unless the content is truly mutually exclusive)

---

## Skeletons & Placeholders

### Rules
- Use to show **content layout before data loads** — mimics the shape of real content
- Match the **actual content structure** — right number of lines, image shapes, etc.
- Use subtle **animation** (shimmer/pulse) to indicate loading
- Transition **smoothly** from skeleton to real content (fade in)
- Better than spinners for **content-heavy pages** — reduces perceived load time
- Don't show skeletons for more than **3-5 seconds** — add a retry option if loading is slow
