# Improve RESQORA UI and user experience

## Scope
Refine the existing operational home screen and its shared emergency interactions without changing data, navigation, or emergency behavior.

## Changes
- Strengthen the first-screen hierarchy so safety status, location readiness, SOS, and accident reporting scan instantly.
- Make emergency tools and nearby-service rows denser, clearer, and easier to tap on mobile.
- Improve the location prompt with clearer trust cues, better error presentation, and a smoother manual-address fallback.
- Standardize spacing, corner treatment, typography, pressed states, focus visibility, and reduced-motion behavior using existing semantic colors.
- Preserve all live states, real data, permissions, links, alerts, and current light/dark themes.

## Validation
- Check desktop and mobile layouts for clipping, overlap, and readable touch targets.
- Exercise the location prompt and manual-address flow.
- Confirm the preview builds cleanly and has no new browser errors.

## Technical details
- Work in the existing React/Tailwind components and design tokens only.
- No backend, database, routing, or emergency-workflow changes.
- Keep every existing action and truthful status message intact.
