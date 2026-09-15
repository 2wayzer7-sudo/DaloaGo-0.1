---
name: Stale demo GPS data
description: Why dispatch acceptance can fail against long-lived development seed data
---

Seeded driver rows may retain an old `lastLocationAt` when the development database persists across sessions. Dispatch correctly rejects an offer when that timestamp exceeds the configured GPS freshness window.

**Why:** A two-client dispatch check initially failed because the driver data was older than the freshness threshold, not because of the trip-status or realtime changes.

**How to apply:** Refresh driver locations before diagnosing dispatch or multi-device trip-flow failures in a long-lived development database.