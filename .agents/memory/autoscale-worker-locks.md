---
name: Autoscale worker locks
description: Distributed coordination for periodic API workers across autoscale instances
---

Periodic workers must acquire a distinct PostgreSQL session-level advisory lock on a dedicated pool connection for each cycle, skip the cycle when unavailable, and release the lock before releasing the connection.

**Why:** Process-local timers run on every autoscale instance; session-level advisory locks ensure only one instance performs a cycle and disappear automatically when the database session ends.

**How to apply:** Keep the timer on every instance, but wrap only the worker cycle with `pg_try_advisory_lock` and `pg_advisory_unlock`; never share a lock key between unrelated workers.