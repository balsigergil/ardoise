# 0007 — Page nesting depth limit

- Status: accepted (decided by the maintainer during M2)
- Date: 2026-11-22
- Milestone: M2

## Context
`pages.path` is an `ltree` of page ids written as 32-hex labels (ADR 0002) with a GiST
index (ARCHITECTURE §4.3). While seeding the large benchmark workspace, inserting a
deep chain failed at depth 52 with `stack depth limit exceeded` (Postgres 17, default
`max_stack_depth` 2 MB). A larger GiST signature length made it worse (depth 28). With
no index, or with a btree, very long paths also exceed index row limits. PRODUCT §2
said pages nest without limit.

## Options considered
1. Replace `path` by an `ancestors uuid[]` column with a GIN index. Measured on the
   1.1M-page seed, it accepts 1,000-deep chains and subtree queries are faster
   (0.25 ms vs 24.5 ms for a 1,111-page subtree), but it changes the data model.
2. Keep `ltree` + GiST and cap the nesting depth.

## Decision
Option 2: pages nest at most **40 levels** deep (`MAX_PAGE_DEPTH`, a margin under the
measured failure at 52). Creating a page deeper, or moving a subtree so that any of its
pages would be deeper, is rejected with `too_deep`. Option 1 remains the path if the
limit proves too low.

## Consequences
- PRODUCT §2 and §5 and ARCHITECTURE §4.3 state the limit.
- `db:seed:large` builds a 40-deep chain instead of 200.
- The Notion import (M8) must flatten or report trees deeper than 40 levels.
