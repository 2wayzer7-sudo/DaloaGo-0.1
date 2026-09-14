---
name: Dispatch offer concurrency
description: Durable constraint for assigning one pending offer per driver.
---

Dispatch candidate selection must lock the driver row inside the same database transaction that creates the offer, then recheck pending offers after the lock.

**Why:** Concurrent sweeps can otherwise observe the same available driver before either transaction commits, creating multiple active offers for one driver.

**How to apply:** Keep transaction queries sequential on a single PostgreSQL transaction client; reserve parallelism for independent transactions outside the transaction.