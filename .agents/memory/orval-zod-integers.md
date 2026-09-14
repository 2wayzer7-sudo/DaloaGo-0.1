---
name: Orval integer schemas with workspace Zod
description: OpenAPI integer response fields can generate unsupported static Zod helpers in this workspace.
---

When the workspace uses the catalog Zod 3 line, avoid OpenAPI `integer` for response and body schema fields that are not path parameters; Orval may emit `zod.int()`, which only exists in Zod 4. Use numeric fields with explicit minimums where integer semantics are not essential, or upgrade the shared Zod catalog deliberately.

**Why:** The generated Zod package is typechecked as part of codegen, so an otherwise valid OpenAPI change can break the entire library build before the app is checked.

**How to apply:** After changing OpenAPI schemas, run codegen and the library typecheck before implementing routes. Keep path parameters integer when `.int()` is emitted on a Zod number instance.