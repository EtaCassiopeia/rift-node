---
layout: default
title: Guides
nav_order: 3
has_children: true
permalink: /guides/
---

# Guides

Task-shaped walkthroughs of the typed DSL. For side-by-side Mountebank JSON mappings see
[Migrating from Mountebank](../mountebank/migration.md); for exact types and signatures see the
[API reference](../reference/sdk-api.md).

- **[The typed DSL](dsl.md)** — building an imposter: stubs, predicates, responses, behaviors,
  faults, proxying, and the escape hatches. Read this first.
- **[Verification](verification.md)** — asserting what an imposter received: `verify()`,
  `recorded()`, the count matchers, and what client-side predicate evaluation does and doesn't
  support.
- **[Scenarios & state](scenarios.md)** — stateful mocks: the `scenario()` FSM builder, runtime
  scenario controls, and per-flow state (`flowState()`, `flowIdFromHeader()`).
