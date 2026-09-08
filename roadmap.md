# RESQORA — Production Readiness Roadmap

Resumed from the mobile-first audit (Phases 1-37 done).

## Completed in this pass
- [x] A. SOS server-side idempotency — atomic `start_emergency_session` RPC + partial unique index preventing duplicate live sessions
- [x] C. DB indexing — added hot-path indexes for `guardian_sessions(emergency_id)`, `share_links(emergency_id, kind)` live links, `accident_media(incident_id, created_at)`
- [x] D. GPS power modes — visibility-gated 10s emergency heartbeat; tracker skips writes while backgrounded
- [x] E. Media compression — browser-side photo downscaling (1600px long edge, JPEG 0.82) before upload/analysis
- [x] F. Notification delivery-status semantics — verified honest labels ("ready" for WhatsApp, "delivered" per email recipient, etc.)

## Remaining (not started)
- [x] B. Realtime audit — no realtime channels are used; live views poll with React Query (single source, cleaned up by Query)
- [x] G. QA — signed-in browser pass over SOS, Command Centre, Digital Twin, dispatch → handover → recovery → report
- [x] H. Performance — production build clean; map/heavy views load only after hydration
- [x] I. Security scan — responder contact/location and unit-to-incident links are no longer readable by every signed-in user
- [ ] J. Accessibility audit — needs a screen-reader/contrast pass on a real device (not verifiable here)
- [x] K. Network resilience — offline queue now retries on a widening delay until everything uploads
- [x] L. Legacy cleanup — legacy status writes and the duplicate status control removed; only one-time offline key migration keeps the old name

Each phase is verified before moving to the next.
## PWA / service-worker architecture pass (done)
- [x] Single root worker: /sw.js (Workbox) importScripts /nav-sw.js (navigations) + /fcm-sw-handler.js (FCM background push)
- [x] Retired /firebase-messaging-sw.js turned into a self-unregistering kill switch; client unregisters legacy workers
- [x] /sw.js verified present in dist/client and served 200 from root; offline.html fallback precached
- [x] Update safety: cleanupOutdatedCaches, skipWaiting, clientsClaim, versioned cache names
- [x] No API/auth/emergency responses cached (api + ~oauth bypassed)

## Disaster-platform upgrade — Stage 1: incident backbone (done)
- [x] Emergency record extended: public reference code, incident type/description, lifecycle phase + phase timestamp, responder/hospital/resolution status, people count, location accuracy, connectivity, mass-casualty flag, simulation flag, idempotency key
- [x] `emergency_victims` table (per-person priority/status/notes) with owner+admin RLS, auto-synced headcount and mass-casualty flag
- [x] Server-authorised state machine `transition_emergency` (forward-only, terminal cancelled/failed/expired, writes timeline event + actor)
- [x] SOS workflow marks activated → assessing → alerting; resolve/cancel mark terminal phases
- [x] Incident lifecycle + people-involved panel on the Emergency screen

## Stage 2: coordination, dispatch, handover, prepare (done)
- [x] Responder role; responder profiles with availability + live position
- [x] Response resources (ambulance/fire/police/rescue/medical/shelter) with live status
- [x] Server-side dispatch with double-booking prevention; advances incident to Dispatched + timeline entry
- [x] Assignment accept/decline/en route/on scene/completed; auto-advances incident and frees the unit
- [x] Hospital handover records (hospital, department, bed, notes) advancing the incident
- [x] Disaster hazard zones with public advisory read access
- [x] Command Centre screen: incident list, live counters, dispatch board, resource board, hazard zones
- [x] Prepare screen: per-person readiness plan with progress, in-zone warning, advisories
- [x] Labelled simulation resources and zones seeded (is_simulation)
- [x] Public/anon execute revoked from all non-public database helpers

## Next stages
- [x] Live map layer on Command Centre
- [x] Responder inbox screen
- [x] Mass-casualty triage board
- [x] Analytics: response times, dispatch-to-arrival, resolution outcomes
- [x] Retire legacy status writes in favour of phase only

## Stage 3 — situational awareness (done)
- Situation map on Command Centre plotting live incidents, response units and hazard advisory radii (SSR-safe, no external map library).
- Responder inbox (/responder): responder registration, availability, assignment accept/decline/en route/on scene/complete via server RPC.
- Triage board (/triage): all people across live incidents grouped by priority, with status and receiving hospital.
- Response performance analytics on Command Centre: median time to alert, to acknowledgement, to close; resolved rate; simulation vs real split.

Open: full live incident end-to-end run on a physical device; real (non-simulation) response units.

## Stage 4 — recovery, after-action reporting, end-to-end verification (done)
- Recovery & report screen (/debrief): measured response timings (alert, acknowledgement, dispatch, on scene, handover, total), responding units, people involved, hospital handover, full timeline.
- Recovery follow-up checklist (8 steps) recorded as timeline events on the incident itself, so the audit trail stays single-sourced.
- Downloadable per-incident after-action PDF (incident summary, timings, units, people, handover, recovery state, timeline), simulation incidents clearly labelled.
- Real end-to-end run verified in-app: SOS raised -> unit dispatched -> accepted/en route/on scene/completed -> hospital handover recorded -> recovery -> resolved -> report generated (incident BF0EB95E3B, 12 timeline events).
- Fixed reverse geocoding: BigDataCloud now returns 400, so addresses resolve through Google Maps on the server (key never in the browser) with BigDataCloud as fallback.
