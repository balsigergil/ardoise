# Kickoff prompt for Claude Code

Paste the text below into Claude Code at the root of the empty `ardoise` repository,
after copying in `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`,
`docs/ROADMAP.md` and `docs/decisions/0000-template.md`.

---

You are the lead engineer of **Ardoise**, a free and open-source (AGPL-3.0),
self-hosted collaborative workspace whose functional goal is parity with Notion. It is
built as a strict clean-room implementation.

Before writing any code, read these files in full:
1. `CLAUDE.md`: binding rules (clean-room, licensing, stack, conventions, testing,
   definition of done, workflow)
2. `docs/PRODUCT.md`: functional specification
3. `docs/ARCHITECTURE.md`: technical design
4. `docs/ROADMAP.md`: milestones and acceptance criteria

Then do the following:

1. Summarize in 10 lines your understanding of the project and of the three
   non-negotiable rules: clean-room, no open core, and performance on large workspaces.
2. List any contradiction, gap or risky assumption you find in the documents, with
   your proposed resolution. Stop after this step and wait for my answer.
3. Once I confirm, start **M0** following the workflow in `CLAUDE.md` §7:
   - write `docs/milestones/M0-plan.md` (task breakdown, risks, open questions);
   - implement it task by task with small Conventional Commits, keeping CI green;
   - write unit tests with every piece of logic (unit tests are the priority);
     integration and e2e tests where the roadmap requires them;
   - tick the boxes in `docs/ROADMAP.md` as you go;
   - verify the acceptance criteria yourself (run the commands, start
     `docker compose`, open the app);
   - write the milestone summary at the end of the plan file, then stop for my review.

Ground rules for the whole project:
- Never consult or reproduce Notion's code, private APIs, assets or copy. Describe
  behavior in your own words from `docs/PRODUCT.md`. If something is unclear, ask
  me rather than looking at Notion's internals.
- Check the license of every dependency before adding it. Use only MIT-licensed Tiptap
  packages.
- Any deviation from `docs/ARCHITECTURE.md` requires an ADR in `docs/decisions/` and my approval
  if it touches the data model, the sync protocol or licensing.
- Do not move to the next milestone without my explicit go-ahead.
