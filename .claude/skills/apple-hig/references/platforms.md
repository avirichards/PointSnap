# Platform Design Reference

Platform-specific design guidance for adapting universal design principles to each target platform.

## Table of Contents
1. [Web](#web)
2. [Mobile — iOS](#mobile--ios)
3. [Mobile — Android](#mobile--android)
4. [Desktop — macOS](#desktop--macos)
5. [Desktop — Windows](#desktop--windows)
6. [Desktop — Linux](#desktop--linux)
7. [Cross-Platform Apps](#cross-platform-apps)
8. [TV (tvOS, Android TV, Smart TVs)](#tv)
9. [Wearables (watchOS, Wear OS)](#wearables)
10. [Spatial / XR (visionOS, Quest)](#spatial--xr)
11. [Games](#games)
12. [Kiosks & Embedded](#kiosks--embedded)

---

## Web

### Characteristics
- Runs in a browser on any device (phone, tablet, desktop)
- Keyboard + mouse primary on desktop; touch on mobile browsers
- URL-based navigation — every view should have a shareable URL
- Progressive enhancement — work across browser capabilities

### Key Principles
- **Responsive design** — fluid layouts that adapt from 320px to 3840px+
- **Performance first** — initial meaningful paint under 2 seconds; Largest Contentful Paint under 2.5s
- **Progressive enhancement** — core functionality works without JavaScript
- **Accessibility** — WCAG 2.1 AA minimum; aim for AAA
- **SEO** — semantic HTML, proper heading hierarchy, meta descriptions

### Layout
- Use CSS Grid and Flexbox — never tables for layout
- **Mobile-first** — design for 320px, then scale up
- **Breakpoints** (common): 480px, 768px, 1024px, 1280px, 1440px
- Standard body max-width: **960-1200px** for content (wider for dashboards)
- Content margins: **16px** mobile, **24-32px** tablet, **32-64px** desktop
- Line length: **45-75 characters** for optimal readability

### Navigation
- Primary nav in the **header** (horizontal on desktop, hamburger on mobile)
- Support **browser back/forward** buttons — never break them
- Use `<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>` for semantic structure
- Support **keyboard Tab navigation** through all interactive elements
- Use **skip links** ("Skip to main content") for screen reader users

### Typography
- Base font: **16px minimum** for body text
- System font stack for performance: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Or use `font-family: system-ui` for modern browsers
- Support **browser zoom** up to 200% without layout breaking (WCAG requirement)

### Performance
- Target **Core Web Vitals**: LCP <2.5s, FID <100ms, CLS <0.1
- Lazy load images below the fold
- Use modern image formats (WebP, AVIF) with `<picture>` fallbacks
- Code-split JavaScript bundles
- Cache aggressively with service workers for repeat visits

### Web-Specific Patterns
- **Infinite scroll** — show count, provide "back to top", maintain scroll position on back navigation
- **Forms** — single column, inline validation, autofill support, no disabling paste
- **Links vs buttons** — links navigate, buttons act. Use `<a>` for navigation, `<button>` for actions
- **Focus management** — after dynamic content loads, move focus appropriately

---

## Mobile — iOS

### Characteristics
- Touch primary; also Apple Pencil, hardware keyboard, Siri
- Portrait-first design
- Safe areas: Dynamic Island, home indicator, status bar

### Key Principles
- **Content over chrome** — maximize content area, minimize navigation UI
- Controls in the **middle or bottom** for thumb reachability
- Support **both orientations** unless the experience requires one
- Support **Dynamic Type** — all text must scale with user settings
- Support **Dark Mode** as a first-class experience

### Navigation
- **Tab bar** (bottom) for 3-5 top-level sections
- **Navigation stack** (push/pop) with swipe-from-left-edge to go back
- **Sheets** (bottom) for modal tasks
- iPadOS: **sidebar** navigation, multitasking support (Split View, Slide Over, Stage Manager)

### Specific Requirements
- Minimum touch target: **44x44pt**
- Standard margins: **16pt** from screen edges
- Respect all safe area insets
- Support **Liquid Glass** material for navigation chrome (iOS 26+)
- Submit to App Store: support all current device sizes, provide privacy nutrition labels

### iOS-Specific Components
- Action sheets (slide-up choices), pull-to-refresh, swipe actions on rows
- Home Screen Quick Actions (long-press icon), Widgets, Live Activities
- Context menus (long-press with preview), share sheets (UIActivityViewController)

---

## Mobile — Android

### Characteristics
- Touch primary; also stylus, keyboard, voice
- Highly variable screen sizes and densities
- Material Design is the native design language

### Key Principles
- Follow **Material Design 3** conventions for native feel
- Design for **dp (density-independent pixels)** — test on ldpi through xxxhdpi
- Support **predictive back gesture** (Android 14+)
- Support **dynamic color** (Material You / Monet) from user wallpaper
- Design for **many screen sizes** — phones, foldables, tablets, Chromebooks

### Navigation
- **Bottom navigation** for 3-5 top-level destinations
- **Navigation drawer** (hamburger) for 5+ destinations (less ideal than bottom nav)
- **Top app bar** with back arrow for hierarchical navigation
- System back button/gesture always goes back — don't override

### Specific Requirements
- Minimum touch target: **48x48dp** (Material guideline)
- Standard margins: **16dp**
- Support **edge-to-edge** display (content behind system bars, with proper insets)
- Support **foldable devices** — adaptive layouts for fold/unfold
- Support **split-screen** and **multi-window** modes

### Android-Specific Components
- FAB (Floating Action Button) — one primary action per screen
- Bottom sheets, snackbars, chips, navigation rail (tablet)
- App shortcuts (long-press icon), widgets

---

## Desktop — macOS

### Characteristics
- Large displays, pointer + keyboard primary, multi-window
- Menu bar provides comprehensive application menus
- Power users expect keyboard shortcuts for everything

### Key Principles
- **Power, spaciousness, flexibility** — show more, don't just enlarge mobile
- Support **multiple simultaneous windows**
- Every action accessible from the **menu bar**
- Keyboard shortcuts for all frequent actions
- Pointer-precision targets (smaller OK — **24x24pt minimum**)

### Navigation
- **Menu bar** — comprehensive application menus (File, Edit, View, Window, Help)
- **Sidebar** for primary navigation within windows
- **Toolbar** at top of window for frequent actions
- **Tabs** for multiple documents/views
- **Preferences/Settings** window via Cmd+,

### macOS-Specific
- Support **traffic light window controls** (close, minimize, fullscreen)
- Support **window resizing** and remember user positions
- Support **Dock menus** (right-click app icon)
- Support **trackpad gestures** (two-finger scroll, pinch, swipe)
- Support **Touch Bar** on applicable hardware (legacy but still used)

---

## Desktop — Windows

### Characteristics
- Largest install base; vast device variety (2-in-1s, desktops, laptops, tablets)
- Mouse + keyboard primary; touch on applicable devices
- **WinUI 3 / Fluent Design** is the native design language

### Key Principles
- Follow **Fluent Design** principles for native feel: light, depth, motion, material, scale
- Support **high DPI** displays (100%, 125%, 150%, 200%+ scaling)
- Support **touch, mouse, and pen** input on 2-in-1 devices
- Support **dark/light** theme following system setting

### Navigation
- **Title bar** with back button and breadcrumbs (NavigationView pattern)
- **Left navigation pane** (collapsible) for primary sections
- **Tab bar** for document-based apps
- **Command bar** (toolbar) for frequent actions
- **Ribbon** for complex, feature-rich applications (Office-style)

### Windows-Specific
- Support **Snap Layouts** (Win+arrow, drag to zones)
- Support **Alt+Tab** and **Taskbar** integration
- System tray icon for background apps
- Support **high contrast** accessibility theme
- Support **Jump Lists** (right-click taskbar icon for quick actions)

---

## Desktop — Linux

### Key Principles
- Follow **GNOME HIG** (libadwaita) or **KDE HIG** depending on target desktop environment
- Support **dark/light** theme following system setting
- Respect **system fonts** and **icon themes**
- Package for multiple formats: Flatpak (preferred), Snap, AppImage, deb/rpm

### Design Considerations
- Linux users often value **keyboard-centric** workflows — robust shortcuts are expected
- Support **tiling window manager** layouts (your app at any aspect ratio)
- Don't assume a specific desktop environment — test on GNOME, KDE, and others
- Use native GTK or Qt widgets for the best integration; Electron apps feel foreign

---

## Cross-Platform Apps

Building one product for multiple platforms (React Native, Flutter, Electron, Kotlin Multiplatform, etc.)

### Principles
- **Shared design language, platform-appropriate details** — don't force iOS patterns on Android or vice versa
- Use a **design token system** — define colors, spacing, typography, and elevation as tokens that map to each platform's values
- Navigation should follow **platform conventions**:
  - iOS: bottom tab bar, swipe-back, sheets
  - Android: bottom navigation, system back, drawers
  - Web: top navigation, URL routing, breadcrumbs
  - Desktop: sidebar, menu bar, keyboard shortcuts

### Adapt These Per Platform
| Element | iOS | Android | Web | Desktop |
|---|---|---|---|---|
| Primary nav | Bottom tab bar | Bottom nav | Top nav bar | Sidebar |
| Back | Swipe left edge | System back button/gesture | Browser back | Toolbar back |
| Modal | Bottom sheet | Bottom sheet | Center dialog | Dialog/panel |
| Primary action | Trailing nav bar | FAB | Button in header | Toolbar button |
| Fonts | SF Pro | Roboto | System stack | System fonts |
| Elevation | Subtle shadows | Material elevation system | Subtle shadows | Platform-native |

### Don't Adapt These
- **Color system** — use your brand tokens everywhere (with light/dark variants)
- **Spacing system** — same base unit (4px/8px) everywhere
- **Icon style** — consistent icon set across platforms
- **Typography scale** — same relative hierarchy, adjusted for platform defaults
- **Content and copy** — same words and messaging everywhere

---

## TV

### Characteristics (tvOS, Android TV, Fire TV, Smart TVs)
- Large screen viewed from **2-5 meters** away
- **Remote control** is primary input (D-pad + select, or Siri Remote touchpad)
- No direct touch — all interaction is **focus-based**

### Key Principles
- Design for the **10-foot experience** — everything must be legible from across the room
- **Focus-based navigation** — one item is focused at a time, moved with directional input
- Content should be **immersive and cinematic**
- Keep interactions **simple** — complex input is hard with a remote
- Design for a **shared environment** — multiple people may be watching

### Rules
- Minimum text size: **much larger** than mobile/desktop (body ~29pt+)
- Focused element: **scale up (1.05-1.1x)** or **add glow/border** to indicate selection
- Support the **back/menu button** to go back — never trap users
- Use **overscan-safe area** — TVs may crop 5% of edges
- Don't rely on text entry — provide search-as-you-type, voice search, and smart suggestions
- Show **content grids** — horizontal scrolling rows of cards/posters (Netflix pattern)

---

## Wearables

### Characteristics (watchOS, Wear OS)
- **Tiny screen** — every pixel counts
- Interactions must be **under 10 seconds**
- **Glanceable** — information at a glance, not prolonged reading
- Input: touch, digital crown/bezel, side button, voice

### Key Principles
- Show **essential information only** — no room for secondary content
- Design for **brief interactions** — seconds, not minutes
- Use **edge-to-edge content** — maximize the small display
- **Minimal controls** — big, tappable buttons that are easy to hit

### Rules
- Minimum touch target: **38x38pt** (Apple Watch), 48dp (Wear OS)
- **Full-width buttons** are preferred
- **Vertical scrolling** lists are the primary layout
- Use **complications/tiles** for glanceable data on the watch face
- Support **always-on display** with a dimmed, simplified layout
- Battery is critical — minimize network calls and update frequency
- Offload complex tasks to the **companion phone app**

---

## Spatial / XR

### Characteristics (visionOS, Meta Quest, WebXR)
- Content exists in **3D space** — infinite canvas
- **Gaze + hand gestures** primary input (look + pinch on visionOS)
- Two modes: alongside other apps (shared space) or fully immersive

### Key Principles
- **Spatial design** — leverage depth and 3D positioning purposefully
- **Comfort first** — avoid eye strain, motion sickness, and physical fatigue
- Start in **windowed/shared mode** — only go immersive when it adds value
- Windows should use **glassy, translucent materials** that blend with the environment

### Rules
- Interactive targets: minimum **60x60pt** for gaze targeting
- Place content at **comfortable viewing distance** (~1.5-2 meters)
- Don't place content requiring extended focus **above or below eye level**
- Provide **hover effects** on all interactive elements (essential gaze feedback)
- Avoid rapid motion in **peripheral vision** (nausea trigger)
- Avoid oscillating motion near **0.2 Hz** (vestibular trigger)
- Don't place content **closer than 0.5 meters** (eye strain)
- Support **passthrough** — let users see their real environment when appropriate
- Sound should be **spatialized** — audio from the direction of its source

---

## Games

### Cross-Platform Principles
- Adapt controls for each platform's primary input method
- Support **game controllers** with on-screen touch fallback
- Use **haptic feedback** for tactile game feel
- Target **60 FPS minimum** (120 FPS for high-refresh displays)

### Platform-Specific
| Platform | Primary Input | UI Scale | Key Consideration |
|---|---|---|---|
| Mobile | Touch | Small, reachable | Battery life, thermal throttling |
| PC | Keyboard + mouse | Standard | Rebindable keys, ultrawide support |
| Console/TV | Controller | 10-foot, large text | Focus-based menus, couch distance |
| VR/XR | Controllers/hands | Spatial | Comfort, motion sickness |
| Web | Mouse/touch | Variable | Performance in browser, load time |

### Performance Rules
- Manage **thermal state** — throttle before the system forces it
- Optimize **battery usage** on mobile — games drain fast
- Support **variable refresh rate** on capable displays
- Provide **graphics quality settings** on PC and console
- Target **consistent frame rate** over maximum visual quality — stuttering breaks immersion

---

## Kiosks & Embedded

### Key Principles
- **Zero learning curve** — users have no training and may be using for the first time
- **Touch primary** — large, obvious buttons; no keyboard expected
- Design for **standing users** at arm's length
- Support **accessibility** — large text, high contrast, multiple languages

### Rules
- Minimum touch target: **60x60px** (larger than mobile — less precise context)
- Text: **24px minimum** for body text
- Always show a **"Start over" or "Home" button**
- Session timeout with **countdown warning**
- Support **multiple languages** with easy switching
- **Error recovery** must be obvious — users can't call IT
