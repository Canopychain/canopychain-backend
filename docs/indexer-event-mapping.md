# Indexer: event-to-database mapping

The indexer (`src/indexer/`) watches two contracts — project-registry and
milestone-vault — and dispatches each event it sees to one of two handler
files by contract id (`src/indexer/dispatch.ts`). This is the map of which
event on each contract writes what, and which events are received but
deliberately not handled. It exists so "why is this column stale" has an
answer that doesn't start with reading the handler source.

## project-registry — `src/indexer/handlers/projectRegistry.ts`

| Event topic | Writes | Notes |
| --- | --- | --- |
| `register` | `projects.on_chain_id`, `projects.operator_address`, `projects.name` (upsert; `approved` set to `false` on create) | The event carries only id, operator, and name. `recipient_address`, `attestor_address`, `polygon_hash`, and `polygon_geojson` are **not** set here — they arrive later via `POST /projects/register`, matched onto this row by `on_chain_id`, and can land before or after this event. |
| `approved` | `projects.approved = true` | `updateMany`, not `update` — a project row may not exist yet if the indexer started mid-history, and this is a no-op rather than a throw in that case. |

Any other topic on this contract is received by `dispatchEvent` but falls
through `handleProjectRegistryEvent` untouched — there is no explicit list
of them in code today, so treat an unrecognized project-registry topic as
silently ignored rather than assuming it is handled.

## milestone-vault — `src/indexer/handlers/milestoneVault.ts`

| Event topic | Writes | Notes |
| --- | --- | --- |
| `deposit` | `projects.total_deposited` (set from the event's running total); `project_donations.amount` (accumulated: prior total + this deposit); creates a placeholder `projects` row (empty `operator_address`, name `Project <id>`) and/or a `donors` row if either doesn't exist yet | The per-donor total isn't in the event payload directly, so it's read-modify-write against the existing `project_donations` row. |
| `attested` | `milestones.status = 'ATTESTED'`, `milestones.attested_at`, `milestones.payout_amount` on the milestone at index `milestonesCompleted - 1`; `projects.total_released` (accumulated: prior total + this payout) | No-ops if the project row doesn't exist yet (`findUnique` returns null → early return) — unlike `deposit`, this handler does not create a placeholder project. |

The following topics are received but **explicitly ignored** (see the
`default` case in `handleMilestoneVaultEvent`): `schedule`, `pause`,
`unpause`, `attestor`, `cancelled`, `refund`. None of them are needed for
the donor-facing explorer or milestone timeline yet — if a future feature
needs one, it belongs in this table once handled.

## Anything not listed here

Events from contracts other than these two are never dispatched at all —
`dispatchEvent` only recognizes `PROJECT_REGISTRY_CONTRACT_ID` and
`MILESTONE_VAULT_CONTRACT_ID` (`src/indexer/contracts.ts`) and drops
anything else in its `default` case.
