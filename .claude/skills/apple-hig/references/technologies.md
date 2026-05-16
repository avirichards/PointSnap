# HIG Technologies Reference

Apple technologies, features, and services to integrate into your app.

## Table of Contents
1. [AirPlay](#airplay)
2. [Always On](#always-on)
3. [App Clips](#app-clips)
4. [Apple Pay](#apple-pay)
5. [Augmented Reality](#augmented-reality)
6. [CareKit](#carekit)
7. [CarPlay](#carplay)
8. [Game Center](#game-center)
9. [Generative AI](#generative-ai)
10. [HealthKit](#healthkit)
11. [HomeKit](#homekit)
12. [iCloud](#icloud)
13. [ID Verifier](#id-verifier)
14. [iMessage Apps and Stickers](#imessage-apps-and-stickers)
15. [In-app Purchase](#in-app-purchase)
16. [Live Photos](#live-photos)
17. [Mac Catalyst](#mac-catalyst)
18. [Machine Learning](#machine-learning)
19. [Maps](#maps)
20. [NFC](#nfc)
21. [Photo Editing](#photo-editing)
22. [ResearchKit](#researchkit)
23. [SharePlay](#shareplay)
24. [ShazamKit](#shazamkit)
25. [Sign in with Apple](#sign-in-with-apple)
26. [Siri](#siri)
27. [Tap to Pay on iPhone](#tap-to-pay-on-iphone)
28. [VoiceOver](#voiceover)
29. [Wallet](#wallet)

---

## AirPlay

- Let users **stream audio and video** to Apple TV, HomePod, and AirPlay-compatible devices
- Show the **AirPlay picker** using the standard route picker button
- Support **AirPlay 2** for multi-room audio
- Continue playback seamlessly when the user switches output devices
- Don't build custom device pickers — use the system component

---

## Always On

- watchOS and iOS (iPhone 14 Pro+) — screen stays **visible at reduced brightness**
- Your app should provide an **Always On** version that:
  - Dims non-essential content
  - Removes sensitive information (hide financial data, health details)
  - Reduces update frequency to save battery
  - Keeps time-sensitive information visible
- Use `TimelineView` and `.isLuminanceReduced` to adapt

---

## App Clips

- Lightweight, focused experiences (< 50 MB) for users who haven't installed your full app
- Triggered by **NFC tags, QR codes, App Clip Codes, Safari, Maps, Messages**
- Must be **immediately useful** — no sign-up or onboarding required
- Provide a **clear path to download the full app** after use
- Use the App Clip Card to show branding and a call to action
- Only request permissions that are immediately needed

---

## Apple Pay

- Use the **standard Apple Pay button** — don't create custom payment buttons
- Show the Apple Pay option **prominently** alongside other payment methods
- Use for **fast, secure checkout** — no need to enter card details
- Support Apple Pay in apps and on the web (via Safari)
- Show an **order summary** before payment confirmation
- Don't require account creation to use Apple Pay

---

## Augmented Reality

- Use **ARKit** for immersive AR experiences
- Help users **find suitable surfaces** before placing content
- Provide coaching overlays to guide device movement
- Use **realistic rendering** — AR content should blend with the real world
- Respect the user's space — don't require too much physical movement
- Handle **tracking loss** gracefully with clear recovery guidance

---

## CareKit

- Build care management apps for **patients and caregivers**
- Use CareKit's standard UI components for consistency
- Display **care plans, tasks, and progress** clearly
- Respect medical data privacy — use HealthKit for storage
- Follow clinical communication best practices

---

## CarPlay

- Design for the **car environment** — minimize distraction, maximize glanceability
- Use **CarPlay templates** (list, grid, tab bar, map, etc.) — custom layouts aren't allowed
- Limit interaction to **essential actions** — nothing that requires extended attention
- Support **Siri** for hands-free control
- Categories: Audio, Communication, Driving/Navigation, Parking, EV Charging, Quick Food Ordering, Fueling

---

## Game Center

- Integrate **achievements, leaderboards, and multiplayer** features
- Use the **Access Point** to show the player's dashboard
- Display **achievement progress** to motivate players
- Support **challenges** for social engagement
- Show the Game Center authentication dialog at launch

---

## Generative AI

Apple's guidelines for responsible AI integration:

### Core Principles
- **User control** — users must be able to review, edit, undo, and override AI output
- **Transparency** — clearly indicate when content is AI-generated; never disguise AI as human
- **On-device processing** — prefer on-device models when possible for privacy
- **Accuracy** — implement safeguards against hallucination; cite sources when applicable
- **Bias awareness** — test for and mitigate bias in AI outputs across demographics
- **Feedback collection** — let users report problems with AI output
- **Copyrighted content** — avoid generating content that infringes on copyrights

### Design Guidelines
- Label AI-generated content with clear visual indicators
- Provide easy **undo/revert** for AI modifications
- Don't auto-apply AI suggestions — let users choose to accept
- Show **confidence levels** when appropriate
- Allow users to **opt out** of AI features entirely
- Be transparent about what data is sent to servers vs. processed on device

---

## HealthKit

- Handle health data with **extreme privacy sensitivity**
- Request only the **specific health data types** your app needs
- Explain clearly **why** you need each data type
- Never share health data with third parties without explicit consent
- Use HealthKit's standard UI for data display where available
- Support **data export** and **deletion**

---

## HomeKit

- Use for **smart home control** — lights, locks, thermostats, cameras, etc.
- Follow the **Room > Accessory > Service** hierarchy
- Support **Scenes** for multi-accessory automation
- Use **Matter** protocol for broad device compatibility
- Show device status clearly and update in real-time
- Handle **offline devices** gracefully

---

## iCloud

- Use for **seamless cross-device data sync**
- Support **iCloud Drive** for document storage
- Use **CloudKit** for structured data sync
- Handle **sync conflicts** gracefully
- Show sync status so users know their data is safe
- Work offline — sync when connectivity returns
- Respect the user's iCloud storage quota

---

## ID Verifier

- Verify age or identity using **IDs stored in Apple Wallet**
- Only request the **minimum necessary information**
- Use the system verification flow — don't build custom ID checking
- Handle verification results without storing the ID data

---

## iMessage Apps and Stickers

- Design for the **Messages app context** — small, focused interactions
- Sticker packs can be standalone or part of a full iMessage app
- Support **compact and expanded** presentation modes
- Keep interactions fast — users are mid-conversation

---

## In-app Purchase

- Use **StoreKit** for all in-app purchases
- Clearly describe what the user is buying before purchase
- Show prices in the **user's local currency**
- Support **Restore Purchases** for previously bought content
- Distinguish between consumable, non-consumable, and subscription purchases
- For subscriptions: show renewal terms, trial periods, and cancellation instructions

---

## Live Photos

- Respect the **live photo format** — don't strip the motion component
- Let users play the live photo with long press
- Support **Live Photo effects**: Loop, Bounce, Long Exposure
- When editing live photos, preserve the motion data

---

## Mac Catalyst

- When bringing iPad apps to Mac, **adapt to Mac conventions**:
  - Add menu bar support
  - Support window resizing and multiple windows
  - Add keyboard shortcuts
  - Support trackpad and mouse hover
  - Adjust touch targets for pointer precision (smaller is OK)
- Don't just port — adapt the experience for the platform

---

## Machine Learning

- Use **Core ML** for on-device machine learning
- Prefer on-device inference for **privacy and performance**
- Handle model predictions gracefully — show confidence, allow correction
- Use **Create ML** for custom model training
- Optimize model size for mobile deployment

---

## Maps

- Use **MapKit** for embedding maps
- Follow Apple Maps conventions for annotations, overlays, and interactions
- Support **Look Around** and **Flyover** where relevant
- Use standard map controls (zoom, compass, user location)
- Provide useful annotations with clear callouts

---

## NFC

- Use for **quick, proximity-based interactions** (tap to read/write tags)
- Support **background tag reading** on compatible devices
- Show clear instructions for how to hold the device near the tag
- Handle read failures gracefully

---

## Photo Editing

- Register as a **photo editing extension** for in-Photos editing
- Preserve the **original photo** — edits should be non-destructive and reversible
- Use the system photo editing UI conventions

---

## ResearchKit

- Build medical research apps with **informed consent**, **surveys**, and **active tasks**
- Use ResearchKit's standard consent and survey UI
- Clearly explain what data is collected and how it's used
- Follow medical research ethics guidelines

---

## SharePlay

- Enable **shared experiences** over FaceTime and Messages
- Keep participants **in sync** — everyone should see the same thing
- Show **who's participating** with clear presence indicators
- Support **Group Activities** framework
- Handle participant join/leave gracefully
- Works with: video, music, screen sharing, and custom activities

---

## ShazamKit

- Add **audio recognition** to identify songs or custom audio
- Use the standard **Shazam UI** when identifying music
- Show recognition results clearly with song metadata
- Support adding recognized songs to the user's library

---

## Sign in with Apple

- **Required** if your app offers any third-party sign-in (Google, Facebook, etc.)
- Display the **standard Sign in with Apple button** — don't create custom buttons
- Respect **Hide My Email** — don't require a real email after sign-in
- Place the Sign in with Apple button **prominently** — at the top of sign-in options
- Support **passkeys** for password-free authentication alongside Sign in with Apple

---

## Siri

- Expose app actions through **App Intents** for Siri voice control
- Define natural, **conversational phrases** for each intent
- Provide **Siri Shortcuts** for common user workflows
- Handle Siri requests **quickly** — voice interactions should be fast
- Support **disambiguation** — ask clarifying questions when needed
- Confirm destructive or ambiguous actions before executing

---

## Tap to Pay on iPhone

- Accept **contactless payments** directly on iPhone — no extra hardware
- Use the standard **payment acceptance flow**
- Support all contactless payment methods (Apple Pay, credit/debit cards, NFC-based wallets)
- Show clear instructions for the customer to tap their card/phone

---

## VoiceOver

- The primary **screen reader** for all Apple platforms
- Every interactive element needs an **accessibility label** (concise name)
- Provide **accessibility hints** for non-obvious actions
- Set **accessibility traits** correctly (button, link, header, image, etc.)
- Group related elements with **accessibility containers**
- Support **accessibility actions** for complex controls (custom swipe actions)
- Test your entire app with VoiceOver — navigate every screen, every flow
- Use **rotor** actions for efficient navigation

---

## Wallet

- Add **passes** to Apple Wallet: boarding passes, tickets, loyalty cards, gift cards, coupons
- Use the standard **Add to Wallet** button
- Design passes following Apple's **pass layout templates**
- Update passes with **push notifications** when information changes (gate change, balance update)
- Include relevant **barcodes/QR codes** for scanning
- Group related passes (multiple boarding passes for one trip)
