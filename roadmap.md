# RESQORA — Production Readiness Roadmap

Resumed from the mobile-first audit (Phases 1-37 done).

## Completed in this pass
- [x] A. SOS server-side idempotency — atomic `start_emergency_session` RPC + partial unique index preventing duplicate live sessions
- [x] C. DB indexing — added hot-path indexes for `guardian_sessions(emergency_id)`, `share_links(emergency_id, kind)` live links, `accident_media(incident_id, created_at)`
- [x] D. GPS power modes — visibility-gated 10s emergency heartbeat; tracker skips writes while backgrounded
- [x] E. Media compression — browser-side photo downscaling (1600px long edge, JPEG 0.82) before upload/analysis
- [x] F. Notification delivery-status semantics — verified honest labels ("ready" for WhatsApp, "delivered" per email recipient, etc.)

## Remaining (not started)
- [ ] B. Realtime subscription audit — verify only one Supabase realtime channel per client, cleanup on unmount
- [ ] G. Final QA matrix — targeted browser verification of SOS/Guardian/report flows
- [ ] H. Performance targets — bundle/runtime profiling
- [ ] I. Full security scan pass
- [ ] J. Accessibility audit (focus traps, ARIA, color contrast)
- [ ] K. Network resilience — offline queue retry/backoff review
- [ ] L. Legacy cleanup — remove any remaining AEGIS references

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

## Next stages (agreed with user)
- [ ] Command Center (/command-center): live incident map, incident list, heatmap, real analytics
- [ ] Responder + dispatch: responder role, accept/decline, resources with conflict prevention, hospital handoff
- [ ] Labelled Simulation Mode seeding demo incidents (is_simulation flag already in place)
- [ ] Prepare layer: preparedness checklists, family plan, shelters
