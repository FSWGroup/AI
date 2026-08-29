# FSW Layer 0

The shared data spine underneath FSW Group's operating businesses — Welsford Co. and
ValveMan.com. Identity, organizations, sites, contacts, products and their engineering
attributes, with full source lineage and audit, exposed through stable APIs so future
applications stop creating another disconnected copy of the same data.

Layer 0 is infrastructure, not a user-facing application. It is deliberately a
PostgreSQL-backed modular monolith.

> **Status: in development, and every architectural decision is provisional.**
> The Gate 1 discovery questions have not been answered. Decisions were made under
> delegated authority and are recorded with the questions they depend on, what breaks if
> they are wrong, and what it costs to change them. See
> [`docs/open-questions.md`](docs/open-questions.md) — answering the blocking set is the
> highest-value thing that can happen to this project.

## Start here

```bash
make dev
```

That should be all a clean clone needs: PostgreSQL, migrations, seed data, and a running
API. If it is not, that is a bug worth fixing.

## Documentation

|                                                    |                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)               | How the system is shaped and the five decisions that shape it       |
| [Decisions](docs/adrs/README.md)                   | 34 ADRs, each with alternatives, consequences and reversal cost     |
| [Implementation plan](docs/implementation-plan.md) | Phases, exit criteria, acceptance-criteria mapping                  |
| [Assumptions](docs/assumptions.md)                 | Every assumption standing in for an unanswered question             |
| [Open questions](docs/open-questions.md)           | What we still need to know, prioritised                             |
| [Testing](docs/testing.md)                         | How to run it, what is tested where, and what the tests have caught |
| [Working rules](CLAUDE.md)                         | The rules a contributor must not break                              |

## The problem this solves

Welsford and ValveMan share manufacturers, brands, products, customers, contacts and
technical knowledge, but the information lives in Prophet 21, Pipedrive, a storefront,
spreadsheets, and people's heads. Today FSW cannot reliably answer:

- Is the ValveMan customer who bought this valve online the same plant a Welsford
  salesperson visits?
- What do we know about this facility across every FSW business?
- What is the canonical technical definition of this valve, regardless of how any
  system describes it?
- What is the approved equivalent from another manufacturer?

Layer 0 exists to answer those.
