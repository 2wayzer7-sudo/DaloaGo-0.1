---
name: Telemetry boundary
description: Architectural constraint for analytics collection around dispatch
---

Trip analytics must observe the existing trip and dispatch records from an independent telemetry worker rather than changing dispatch behavior. Measurements that the product does not yet produce, such as actual route distance or duration, stay nullable instead of being inferred.

**Why:** The analytics scope must not alter dispatch, fare, commission, prediction, prioritization, or repositioning behavior, and invented operational measurements would make reports misleading.

**How to apply:** Add new event observers or analytics fields at the route/worker boundary; only populate values from real persisted events or direct trip data.