# Design Foundations Reference

Universal design foundations derived from Apple's Human Interface Guidelines philosophy, applicable to any platform.

## Table of Contents
1. [Accessibility](#accessibility)
2. [App & Brand Icons](#app--brand-icons)
3. [Branding](#branding)
4. [Color](#color)
5. [Dark Mode](#dark-mode)
6. [Iconography](#iconography)
7. [Images & Media](#images--media)
8. [Inclusion](#inclusion)
9. [Layout](#layout)
10. [Materials & Surfaces](#materials--surfaces)
11. [Motion & Animation](#motion--animation)
12. [Privacy](#privacy)
13. [Internationalization](#internationalization)
14. [Typography](#typography)
15. [Writing & Microcopy](#writing--microcopy)

---

## Accessibility

Design for everyone. Accessibility is not an afterthought — it's a fundamental quality of good design.

### Vision
- All text must be **scalable** — support user-preferred text sizes (Dynamic Type on mobile, browser zoom on web, OS-level scaling on desktop)
- Maintain minimum **contrast ratio of 4.5:1** for normal text (WCAG AA); **7:1 recommended** (AAA)
- **3:1 minimum** for large text (18pt+ or 14pt+ bold), UI components, and meaningful graphics
- Support **screen readers** — every interactive and meaningful element needs an accessible name
- Don't rely on color alone to convey information — always pair with icons, text, or patterns
- Support **high contrast** modes and user contrast preferences
- Use semantic markup (HTML headings, ARIA roles, platform accessibility APIs)

### Hearing
- Provide **captions and subtitles** for all audio/video content
- Use **visual feedback** (and haptics on supported devices) alongside audio cues
- Don't rely on sound alone for alerts or status changes

### Motor
- **Minimum interactive target sizes:**
  - Touch devices: **44x44px** (Apple standard), 48x48dp (Material/Android)
  - Pointer devices: **24x24px** minimum
  - Web: **44x44px** recommended (WCAG 2.5.8), **24x24px** minimum (WCAG 2.5.5)
- **Spacing between targets:** at least 8px to prevent mis-taps
- Support **simple gestures** — don't require complex multi-finger or timed gestures as the only interaction
- Support **keyboard-only navigation** for all functionality
- Support **switch control**, **voice control**, and other assistive input methods
- Place frequently used controls within easy reach (thumb zone on mobile)

### Cognitive
- Keep interactions simple — one clear action per step
- Support **reduced motion** — replace animations with fades or cuts
- Use clear, consistent language and icons
- Provide **undo** for destructive actions
- Don't auto-advance or use time limits unless essential

### Target Size Quick Reference
| Context | Minimum Target | Recommended |
|---|---|---|
| Touch (mobile) | 44x44px | 48x48px |
| Pointer (desktop) | 24x24px | 44x44px |
| Web (WCAG 2.5.8) | 24x24px | 44x44px |
| Watch/small screens | 38x38px | 44x44px |
| Gaze/spatial | 60x60px | 80x80px |

---

## App & Brand Icons

- Convey a **single, instantly recognizable concept**
- Design a **unique silhouette** — identifiable without color
- Keep it **simple** — avoid detail that becomes muddy at small sizes
- Avoid text in icons — it's unreadable at small sizes and doesn't localize
- Test at every size your icon will appear: favicons (16px), app icons (1024px), and everything between
- Don't use photographs — use graphic/illustrated representations
- Ensure the icon works on **both light and dark backgrounds**

---

## Branding

- **Defer to content** — your product's value is its content and functionality, not its brand
- Use a **brand accent color** to tint interactive elements consistently
- Custom typefaces are fine but must support text scaling and accessibility
- Don't plaster logos everywhere — the icon and initial screen are sufficient
- **Never use splash screens or brand animations** on launch — get users to content immediately
- Branding should feel like seasoning, not the main course

---

## Color

### Usage Principles
- Use color **consistently** — the same color should mean the same thing throughout your product
- Support **light and dark** modes
- Support **high contrast** preferences
- Test in all appearance modes and contrast settings
- Use **wide color gamut** (P3/Display P3) when available for vibrant, accurate color

### Semantic Color System
Build your color system around purpose, not specific values:
- **Primary** — brand color, primary interactive elements
- **On-Primary** — text/icons on primary color surfaces
- **Background** — primary content background
- **Surface** — cards, elevated containers
- **Text (primary/secondary/tertiary)** — hierarchy of text importance
- **Error/Warning/Success/Info** — semantic status colors
- **Separator** — visual dividers
- **Disabled** — inactive elements (maintain 3:1 contrast minimum)

### Color Independence
- **Never use color as the sole indicator** of meaning, state, or urgency
- Always pair color with: icons, text labels, patterns, position, or shape
- Example: Don't show errors with only a red border — add an error icon and descriptive text

### Accessibility
- **4.5:1** contrast for normal text against background
- **3:1** contrast for large text, UI elements, and graphical objects
- **7:1** for enhanced/AAA compliance (recommended)
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia)

---

## Dark Mode

- **Must support** both light and dark appearances — it's a user expectation
- Use **semantic/adaptive color tokens** that automatically adjust per mode
- Maintain required contrast ratios in **both modes** — test thoroughly
- Don't just invert colors — dark mode needs its own considered palette
- Backgrounds: use dark grays (not pure black for most surfaces); reserve true black for OLED optimizations or high-contrast needs
- Elevated surfaces should be **lighter** in dark mode (opposite of light mode)
- Provide separate image/icon assets if they don't read well in both modes
- Test with real content in both modes — images, avatars, and user content can clash

---

## Iconography

- Represent a **single concept** with a clear graphic
- Must be **instantly understandable** without a label (though labels are still important for accessibility)
- Design for the **smallest size first**, then add detail at larger sizes
- Maintain **consistent stroke weight, style, and optical size** across your icon set
- Use **filled variants** for selected/active states, **outlined** for inactive (or vice versa, but be consistent)
- Consider using established icon libraries: SF Symbols (Apple), Material Icons (Google), Lucide, Heroicons, Phosphor
- Every icon used as an interactive element needs an **accessible label**

---

## Images & Media

- Provide images at **appropriate resolutions** for the device (1x, 2x, 3x; or responsive `srcset` on web)
- Use **vectors** (SVG) for icons, logos, and illustrations — they scale perfectly
- Optimize file sizes — use modern formats (WebP, AVIF) where supported
- Provide **alt text** for all meaningful images (screen readers)
- Use `role="presentation"` or empty alt for purely decorative images
- Handle missing/broken images gracefully — show a placeholder, never a broken state
- Support **wide color (P3)** for photographs and rich imagery when the display supports it
- Respect aspect ratio — never stretch or distort images

---

## Inclusion

- Use **respectful, inclusive language** — avoid jargon, idioms, or culturally specific references that exclude
- Don't assume **gender, age, ethnicity, ability, or identity**
- Represent **diverse people** in illustrations, photos, and example content
- Design for the **widest possible audience** from the start — not as a retrofit
- Test with diverse users
- Consider global audiences — dates, currencies, names, and addresses vary widely
- Avoid stereotypes in personas, examples, and placeholder content

---

## Layout

### Responsive & Adaptive Design
- Design for **fluid layouts** that adapt to any screen size
- Use **flexbox, grid, Auto Layout, or equivalent** — never fixed pixel layouts for responsive contexts
- Respect **safe areas** and system UI (notches, status bars, browser chrome, OS taskbars)
- Support **all orientations** unless the experience genuinely requires one
- Design for the **smallest supported viewport** first, then scale up (mobile-first)

### Spacing System
Use a consistent spacing scale based on a base unit (typically 4px or 8px):
- **4, 8, 12, 16, 20, 24, 32, 40, 48, 64px** — common scale values
- Standard content margins: **16px** (compact/mobile), **20-24px** (regular), **32px+** (wide/desktop)
- Consistent spacing creates visual rhythm and reduces cognitive load

### Grid & Alignment
- Align elements to a **consistent grid**
- Use **baseline alignment** for text across columns
- Maintain **consistent gutters** between columns and items
- Content should feel ordered, not scattered

### Text Scaling & Reflow
- Layouts must accommodate text that is **200% larger** than default (WCAG requirement)
- Long labels should **wrap**, not truncate, at large sizes
- Consider **stacking elements vertically** when horizontal space is constrained
- Test at minimum and maximum text size settings

### Content Hierarchy
- The most important content should be **visible without scrolling** (above the fold)
- Use size, weight, color, and whitespace to establish **visual hierarchy**
- Group related elements with proximity; separate unrelated elements with space

---

## Materials & Surfaces

Surfaces create depth and hierarchy in your interface.

### Elevation & Depth
- Use **elevation** (shadows, layers) to convey hierarchy — higher elements are closer to the user
- Consistent shadow system: subtle for cards, more pronounced for modals and popovers
- In dark mode, elevated surfaces are **lighter** (not shadowed — shadows are invisible on dark)

### Translucency & Blur
- Translucent/blurred materials (frosted glass, acrylic, Liquid Glass) work well for **navigation chrome and overlays** — they maintain context of what's behind
- Use translucency **sparingly** — overuse makes everything feel muddy
- Never use translucent materials for **primary content backgrounds** — content needs a solid, readable surface
- Ensure text on translucent surfaces maintains required contrast ratios regardless of what's behind

### Layering Rules
- **Background layer** — solid, content behind everything
- **Content layer** — cards, lists, primary UI
- **Chrome layer** — navigation bars, toolbars, tab bars (may use translucent materials)
- **Overlay layer** — modals, sheets, popovers (typically with scrim/dimming behind)
- Don't stack translucent layers — it creates visual noise

---

## Motion & Animation

- **Purposeful** — every animation should communicate something: a transition, a state change, a relationship
- **Brief** — animations should be fast (200-500ms for most transitions); don't make users wait
- **Interruptible** — users should be able to cancel or redirect animations mid-flight
- Provide **realistic physics** — use easing curves, spring dynamics, not linear motion
- **Reduced motion support is mandatory** — replace complex animations with simple fades/cuts when the user requests it
- Don't animate just because you can — gratuitous animation is worse than none
- Common animation patterns:
  - **Entrance/exit** — fade, scale, slide (pick one per component type and be consistent)
  - **State transitions** — smooth color/size changes between states
  - **Feedback** — subtle bounce, shake, or pulse to confirm actions
  - **Spatial** — slide direction should match navigation direction (forward = slide left)

### Dangerous Motion Patterns
- Avoid **parallax scrolling** that moves at different speeds — causes motion sickness
- Avoid **auto-playing carousels** with fast transitions
- Avoid **oscillating/pulsing** motion (especially near 0.2 Hz — vestibular trigger)
- Avoid **large-scale zooming** without user control
- Never **trap users** in an animation they can't skip

---

## Privacy

- Request **only the data you actually need** — don't ask for permissions speculatively
- Prefer **on-device/client-side processing** over sending data to servers
- Explain **why** you need each permission in clear, specific language (not "to improve your experience")
- Use **just-in-time permission requests** — ask when the feature is about to be used, not on first launch
- Provide a clear **privacy policy** accessible from within the product
- Don't condition core functionality on unnecessary data sharing
- Support **data export and deletion** (legally required in many jurisdictions: GDPR, CCPA)
- Display clear indicators when the camera, microphone, or location are actively in use

---

## Internationalization

- **Mirror the entire layout** for right-to-left languages (Arabic, Hebrew, Urdu, etc.)
- Use **start/end** (not left/right) for alignment and padding — it auto-mirrors
- Don't mirror: media playback controls, graphs with time axes, phone numbers, musical notation
- Test with **actual translated text** — some languages are 30-50% longer than English
- Support **pluralization rules** — they vary dramatically between languages
- Format dates, times, numbers, and currency according to **locale settings**
- Don't embed text in images — it can't be translated
- Use **Unicode/UTF-8** everywhere

---

## Typography

### Type Hierarchy
Establish a clear hierarchy with consistent text styles:

| Role | Web Default | Mobile Default | Weight |
|---|---|---|---|
| Display/Hero | 36-48px | 34pt | Light-Regular |
| Title 1 | 28-32px | 28pt | Regular |
| Title 2 | 22-24px | 22pt | Regular |
| Title 3 | 18-20px | 20pt | Regular-Semibold |
| Headline | 16-17px | 17pt | Semibold-Bold |
| Body | 16px | 17pt | Regular |
| Callout | 15-16px | 16pt | Regular |
| Caption | 12-13px | 12pt | Regular |
| Overline/Label | 11-12px | 11pt | Medium-Semibold |

### Key Rules
- **Minimum body text:** 16px on web, 17pt on mobile — smaller causes eye strain
- **Minimum readable text:** 11-12px — use only for captions and secondary info
- **Maximum line length:** 45-75 characters per line (optimal ~66) for comfortable reading
- **Line height:** 1.4-1.6x font size for body text; tighter (1.1-1.3x) for headings
- Support **user text scaling** — Dynamic Type (Apple), font scaling (Android), browser zoom (web)
- Limit to **2-3 typefaces** maximum in a product
- Use font **weight and size** to create hierarchy — not many different typefaces
- Custom fonts must also support text scaling

### Font Selection Guidance
- **Sans-serif** (SF Pro, Inter, system-ui) — general UI, clean and modern
- **Serif** (New York, Georgia, Lora) — reading-heavy content, editorial feel
- **Monospace** (SF Mono, JetBrains Mono, Fira Code) — code, data, technical content
- System fonts are optimized for their platform and always the safest choice

---

## Writing & Microcopy

Words are an essential part of the user experience — every label, message, and instruction is a design decision.

- Use **clear, concise language** — avoid jargon and marketing-speak
- Write in **active voice** with a friendly, direct tone
- Use **sentence case** for UI labels (not Title Case) — it's more natural and scannable
- Be **specific** in button labels: "Delete Photo" not "OK", "Save Changes" not "Submit"
- Error messages must explain **what happened** AND **what to do next**
- Avoid negative framing — "Keep editing" instead of "Don't discard"
- Confirmation dialogs should have **descriptive button labels**, not "Yes/No" or "OK/Cancel"
- Keep instructional text **scannable** — short sentences, bullet points, bold key terms
- Placeholder text is not a label — it disappears on focus and is inaccessible. Always use a visible label.
- Write for **scanning, not reading** — users don't read UI, they scan it
