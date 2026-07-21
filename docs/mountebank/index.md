---
layout: default
title: Mountebank compatibility
nav_order: 4
has_children: true
permalink: /mountebank/
---

# Mountebank compatibility

`@rift-vs/rift` ships two coexisting APIs in the same process, permanently:

- **Mountebank compat** — `create()` (also at `@rift-vs/rift/compat`) spawns the engine and speaks
  the exact Mountebank wire protocol: raw JSON imposters over `POST /imposters`, the `mb` CLI, and
  existing REST tooling. Nothing about this contract is deprecated or scheduled for removal.
- **Typed DSL** — `imposter()`/`stub()`/`onGet()`/… builders across `rift.embedded()`,
  `rift.spawn()` and `rift.connect()`, plus `imposter.verify(...)`.

**You do not have to migrate.** The two can be adopted incrementally, stub by stub, in the same
codebase — a raw Mountebank imposter JSON round-trips through `fromJson()` and can be mixed with
DSL-built imposters on the same engine.

- **[Migrating from Mountebank](migration.md)** — the complete concept-by-concept mapping: every
  predicate operator, response type, behavior, fault, proxy option, script kind and scenario
  concept, plus escape hatches and the things Rift deliberately rejects.
