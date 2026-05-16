# Input Methods Reference

Universal input method guidance across all platforms, derived from Apple's HIG philosophy.

## Table of Contents
1. [Touch](#touch)
2. [Mouse & Trackpad](#mouse--trackpad)
3. [Keyboard](#keyboard)
4. [Pen & Stylus](#pen--stylus)
5. [Voice](#voice)
6. [Gamepad & Controllers](#gamepad--controllers)
7. [Gaze & Spatial Input](#gaze--spatial-input)
8. [Gestures](#gestures)
9. [Motion Sensors](#motion-sensors)
10. [Assistive Input](#assistive-input)
11. [Proximity & NFC](#proximity--nfc)
12. [Multi-Modal Input](#multi-modal-input)

---

## Touch

Primary input on mobile devices (phones, tablets, kiosks).

### Rules
- Minimum touch target: **44x44px** (Apple), 48x48dp (Material) — err on the larger side
- Minimum spacing between targets: **8px**
- Touch targets can be **larger than the visible element** — extend the hit area invisibly
- Design for **thumb zones** on phones — primary actions in the bottom half of the screen
- Support **both one-handed and two-handed** use
- Touch feedback should be **immediate** — show press states instantly (50ms or less)
- Don't require **precise targeting** — fingers are imprecise (~7mm contact area)

### Touch States
| State | Visual Feedback |
|---|---|
| Default | Normal appearance |
| Pressed/Active | Dimming, scale down, or highlight |
| Disabled | Reduced opacity (40-50%) |
| Long-press | Scale up, context menu |

---

## Mouse & Trackpad

Primary input on desktop; secondary on tablets.

### Mouse
- Support **hover states** on all interactive elements — change cursor, show highlight
- Support **right-click context menus** on all interactive elements
- Support **scroll wheel** for scrolling and zooming (with modifier key)
- Show appropriate **cursor styles**: pointer (links/buttons), text cursor (inputs), grab (draggable), resize (edges), crosshair (precision), not-allowed (disabled targets)

### Trackpad
- Support **multi-touch gestures**: two-finger scroll, pinch to zoom, swipe to navigate
- Show **hover effects** even for trackpad — it behaves like a mouse for pointer position
- Support **force/pressure click** where available (e.g., macOS force touch)

### Pointer Interaction Principles
- Interactive elements should have **visual response on hover** — this is how users confirm they can interact
- The pointer should **snap/magnetize** to nearby targets for easier targeting
- Provide **immediate visual feedback** — no delay on hover

---

## Keyboard

Essential for productivity on desktop; important secondary input on mobile with hardware keyboards.

### Standard Shortcuts (Cross-Platform)
| Action | macOS | Windows/Linux |
|---|---|---|
| Copy | Cmd+C | Ctrl+C |
| Paste | Cmd+V | Ctrl+V |
| Cut | Cmd+X | Ctrl+X |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Y or Ctrl+Shift+Z |
| Save | Cmd+S | Ctrl+S |
| Select All | Cmd+A | Ctrl+A |
| Find | Cmd+F | Ctrl+F |
| Close | Cmd+W | Ctrl+W |
| Quit | Cmd+Q | Alt+F4 |

### Rules
- **All interactive elements** must be reachable via keyboard (Tab/Shift+Tab navigation)
- Visible **focus indicators** on all focused elements — never remove the focus ring without providing a custom one
- Support **Tab** to move between form fields
- Support **Enter/Return** for primary action confirmation
- Support **Escape** to cancel/close/dismiss
- Support **arrow keys** for navigating within components (menus, lists, grids, tabs)
- Show **keyboard shortcut hints** in tooltips and menus
- On mobile with hardware keyboard, show the **keyboard shortcut overlay** (hold Cmd on iPad)

### Software Keyboards (Mobile)
- Configure the correct **keyboard type** for each input:
  - `text` — general text
  - `email` — @ and . prominent
  - `tel` — phone number pad
  - `url` — / and .com prominent
  - `number` — numeric pad
  - `search` — search with Go/Search return key
- Set appropriate **return key label**: Go, Search, Send, Done, Next
- Support **input accessory bars** for common actions above the keyboard
- Handle keyboard **show/hide gracefully** — adjust layout, scroll focused field into view, don't let content get covered

---

## Pen & Stylus

Precision input for drawing, writing, and annotation (iPad + Apple Pencil, Surface Pen, Wacom, etc.)

### Rules
- Support **pressure sensitivity** for drawing/painting tools
- Support **tilt detection** for natural brush behavior
- Support **palm rejection** — users rest their hand on the screen while drawing
- Support **hover** for preview before committing a stroke (when hardware supports it)
- Provide **tool switching** gestures (double-tap to switch tools on Apple Pencil 2+)
- All text fields should support **handwriting input** (Scribble on iPadOS — don't disable it)
- The pen is for **precision tasks** — don't require it for basic navigation (touch should also work)

---

## Voice

Voice input via system assistants (Siri, Google Assistant, Alexa) and in-app voice features.

### Rules
- Expose key actions for **voice control** (Siri Shortcuts, Google Actions, Alexa Skills)
- Define **natural-language phrases** for each voice action
- Handle voice requests **quickly** — voice interactions feel slow if they take more than 2-3 seconds
- Support **disambiguation** — ask clarifying questions for ambiguous commands
- **Confirm destructive actions** before executing via voice
- Support **dictation** in text fields (system feature — don't block it)
- All UI should be operable via **Voice Control** accessibility feature (label all controls)

---

## Gamepad & Controllers

For games and media applications.

### Rules
- Support **standard controller frameworks** (Game Controller framework, XInput, etc.)
- Provide **on-screen touch controls** as a fallback when no controller is connected
- Support **haptic feedback** through the controller (adaptive triggers, rumble)
- Allow **button remapping** for accessibility
- Show **platform-appropriate button glyphs** (A/B/X/Y for Xbox, shapes for PlayStation, etc.)
- Support **motion controls** (gyroscope) as an option, not a requirement
- On TV platforms, the remote is the default controller — design for its limited input

---

## Gaze & Spatial Input

For spatial/XR platforms (Apple Vision Pro, Meta Quest, etc.)

### Rules
- Gaze is the primary **targeting method** — users look at something to select it, then use a gesture to activate
- Design targets that are **large enough for comfortable gaze targeting**: minimum 60x60pt
- Provide **hover/highlight effects** on all interactive elements — essential feedback for gaze input
- Don't require **sustained gaze** — it causes eye strain
- Don't track eye position for **analytics or non-interaction purposes** — it's a privacy violation
- Place interactive elements with **enough spacing** to avoid targeting errors
- Support **indirect hand gestures** — user's hands can be resting (not extended)
- Use **pinch gestures** for selection and manipulation in spatial contexts

---

## Gestures

Standard gestures users expect across platforms.

### Touch Gestures
| Gesture | Common Purpose |
|---|---|
| **Tap** | Activate control, select item |
| **Double-tap** | Zoom, select word |
| **Long press** | Context menu, enter edit mode, preview |
| **Swipe** | Scroll, navigate, reveal actions |
| **Pinch** | Zoom in/out |
| **Rotate** | Rotate content (two-finger) |
| **Pan/Drag** | Move content or objects |
| **Edge swipe** | System navigation (back, home, control center) |

### Trackpad Gestures
| Gesture | Common Purpose |
|---|---|
| **Two-finger scroll** | Scroll content |
| **Pinch** | Zoom |
| **Two-finger swipe** | Navigate back/forward |
| **Three-finger swipe** | Switch spaces/desktops |

### Rules
- **Never override system gestures** — edge swipes, home gesture, back swipe are sacred
- Don't require **complex or non-standard gestures** as the only way to access features
- Provide **visual affordances** that hint at available gestures (grab handles, swipe indicators)
- Support **gesture cancellation** — if a user starts a swipe and changes their mind
- Multi-finger gestures are **less discoverable** — always provide an alternative
- **Never require shake** as the only way to perform an action (accessibility barrier)
- Every gesture-accessible action should also be accessible via **buttons or menus**

---

## Motion Sensors

Gyroscope, accelerometer, magnetometer — for immersive experiences.

### Rules
- Use motion data for **games, AR, fitness, and navigation** — not for basic UI interaction
- Always provide an **alternative input method** — not everyone can move their device
- Handle **all device orientations** gracefully
- Calibrate on first use if precision matters
- Respect **Reduce Motion** preferences for motion-based UI effects
- Consider **battery impact** — continuous sensor access drains battery

---

## Assistive Input

Design for switch control, voice control, head tracking, and other assistive technologies.

### Rules
- All functionality must be available via **keyboard** — this enables most assistive tech
- Provide **accessibility labels** on every interactive element
- Support **focus-based navigation** — logical, predictable tab order
- Group related elements into **accessibility containers**
- Provide **accessibility actions** for complex interactions (custom swipe actions for VoiceOver)
- Test with actual assistive technologies: VoiceOver/TalkBack, Switch Control, Voice Control
- Support **single-switch scanning** — the interface should be operable with a single input
- Large touch targets help **motor-impaired users** — bigger is always more accessible

---

## Proximity & NFC

Short-range wireless interaction.

### Rules
- Use for **quick, tap-to-interact** experiences (payments, pairing, sharing)
- Show **clear instructions** for how to position the device
- Handle **failures gracefully** — NFC reads can fail, so provide retry and fallback
- Respect privacy — only share data when the user has explicitly initiated the interaction

---

## Multi-Modal Input

Modern devices support multiple simultaneous input methods. Design for seamless transitions.

### Principles
- Users **switch between input methods** constantly — touch to type to trackpad to voice
- Your interface should **adapt in real-time** — show hover states when a pointer appears, show touch-appropriate targets when touch is detected
- Don't **lock users into one input mode** — if someone connects a keyboard to their tablet, keyboard shortcuts should start working immediately
- The same action should work across **all supported input methods** — tap, click, keyboard, voice, assistive tech
- **Test with every input combination** your platform supports

### Adaptation Rules
| Signal | Response |
|---|---|
| Pointer detected | Show hover states, reduce touch target padding |
| Touch detected | Enlarge targets, hide mouse-specific UI (e.g., scrollbar) |
| Keyboard attached | Enable keyboard shortcuts, show focus indicators |
| Controller connected | Switch to focus-based navigation, show controller glyphs |
| Voice command | Process without visual interaction required |
