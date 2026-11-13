# Parts

The map for part sessions. Each part session builds one folder below from this file alone: its step folders
(`step.toml`, `problem/`, `solution/`, `wrong/<mistake>/`, `images/expected.png` for screen steps), one
`checks/<step-name>.ts` per step, and the Walkthrough commands in its README (replacing every `TODO(part session)`).

## What a part session can rely on

| Need                                       | Where                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start, break and heal the world            | `bun run world`, `bun run world break <scenario>`, `bun run world heal`, `bun run world try <step>` (scripts/world.ts)                                                                                                                                                                                                 |
| The planted faults and their right answers | `world/scenarios/<scenario>.json`; the run's verification code is in `world/.state/scenario.json` (`code`), written by `world break`                                                                                                                                                                                   |
| Telemetry as the AI SRE sees it            | `world/lib/clickhouse.ts` `chQuery` as the read-only `sre_agent` user                                                                                                                                                                                                                                                  |
| Live or recorded, per folder               | `checks/lib/world.ts`: a folder with `recorded-world.txt` is checked against that recording (CI), others against the live world                                                                                                                                                                                        |
| Recordings                                 | `bun run record <name> [minutes]` writes `world/recordings/<name>/`; `checks/lib/recorded.ts` plays it back in chdb with timestamps moved to now. `bad-release` exists (incident, finding, approval, rollback, verification)                                                                                           |
| Running booking-web with learner code      | `checks/lib/booking.ts` `startBooking(dir)` on SQLite with a local OTLP receiver (`checks/lib/otlp.ts`)                                                                                                                                                                                                                |
| The audit log                              | `sre.incident_events` (kinds: incident_opened, finding_submitted, finding_refused, remediation_proposed, proposal_refused, remediation_refused, remediation_approved, remediation_rejected, remediation_edited, remediation_executed, remediation_failed, verification_passed, verification_failed, incident_resolved) |
| The AI SRE contract                        | harbour-control MCP at `http://localhost:8090/mcp`, bearer `SRE_MCP_TOKEN`: `submit_finding`, `propose_remediation`, `execute_remediation` plus read tools (world/harbour-control/harbour_control/tools.py)                                                                                                            |
| HyperDX's own MCP                          | `http://localhost:8080/api/mcp`, bearer `HYPERDX_ACCESS_KEY` from `.env`; 32 tools on 2.44.0, 9 with readOnlyHint false                                                                                                                                                                                                |
| A replayed agent                           | `agent/replay.ts` cassettes in `agent/cassettes/`; tool inputs may reference earlier results with `$from`. Judge model behaviour over 3 fresh replay runs                                                                                                                                                              |
| Pictures                                   | `bun run shots` (scripts/shots.ts); add a block per new screen step                                                                                                                                                                                                                                                    |

Rules every part keeps: no step over 30 minutes; no time words in learner files; numbers in learner text only
from a company's own page read on the day, cited, or dropped; models only through `config/models.ts` roles.

## `parts/01-see-every-signal`

See every signal. 4 steps, 70 minutes, built in the spine.

| Step                   | Minutes | The learner produces                        | The check reads                                                         |
| ---------------------- | ------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `list-the-services`    | 15      | `list-the-services.sql`                     | your query's rows against the reference rows, live or recorded          |
| `tag-the-release`      | 20      | `telemetry.ts` with `service.version`       | every span booking-web exports under a release name you cannot guess    |
| `add-the-checkin-span` | 20      | `checkin.ts` with a `checkin.validate` span | the check-in trace: span name, `booking.ref`, parent span               |
| `hide-the-email`       | 15      | `redact.ts`                                 | every exported span attribute and log line, scanned for email addresses |

## `parts/02-know-when-it-is-broken`

Know when it is broken. 4 steps, 70 minutes, skeleton: README only.

| Step                   | Minutes | The learner produces                                                  | The check reads                                                                                 |
| ---------------------- | ------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `chart-the-error-rate` | 15      | `chart-the-error-rate.sql`: errors over requests per 10 second bucket | rows against the reference shape on the recorded bad-release window; every rate between 0 and 1 |
| `flag-the-anomaly`     | 20      | a 3 sigma rule over a clean baseline                                  | pages on the recorded bad-release window, silent on the recorded noisy-morning window           |
| `burn-the-budget`      | 20      | SLO burn for a 99.5% booking objective over 5 minutes and 1 hour      | burn rate within 1% of the reference; the page rule fires on bad-release only                   |
| `count-the-pages`      | 15      | `answers/count-the-pages.md`: pages before and after your rule        | replays the recorded windows and gets the same two numbers                                      |

## `parts/03-look-without-touching`

Look without touching. 4 steps, 70 minutes, skeleton: README only.

| Step                     | Minutes | The learner produces                                                            | The check reads                                                                                                     |
| ------------------------ | ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `connect-the-read-tools` | 20      | your MCP client connected to HyperDX's MCP and harbour-control, read tools only | the client's MCP config and tools/list: every allowed tool has readOnlyHint true; an INSERT as sre_agent is refused |
| `find-the-new-pattern`   | 20      | `find-the-new-pattern.sql`: log patterns new in the incident window             | the top row on the recorded bad-release window is the pool exhausted pattern on release v2                          |
| `open-the-slowest-trace` | 15      | `open-the-slowest-trace.sql`: failing first, then slowest                       | the first trace id is a failing booking-web trace with an audit_trail span over 1 s                                 |
| `name-the-release`       | 15      | errors by release for the incident window                                       | v2 error rate above 25%, v1 under 1%, on the recording                                                              |

## `parts/04-say-what-broke`

Say what broke and prove it. 3 steps, 55 minutes, skeleton: README only.

| Step                       | Minutes | The learner produces                                                     | The check reads                                                                                                |
| -------------------------- | ------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `write-the-finding`        | 20      | `findings/bad-release.json` written by your agent through submit_finding | the stored finding: planted service and change, the planted verification code in the quote, trace ids grounded |
| `refuse-the-guess`         | 15      | a finding with one made-up trace id, sent on purpose                     | a finding_refused row in sre.incident_events with the reason                                                   |
| `rule-out-the-distractors` | 20      | the agent's finding for noisy-morning                                    | change kind none, and the card declines and the old TLS blip named in ruled_out                                |

## `parts/05-ask-before-you-act`

Ask before you act. 6 steps, 100 minutes, skeleton: README only.

| Step                        | Minutes | The learner produces                                                  | The check reads                                                                      |
| --------------------------- | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `propose-one-change`        | 15      | a propose_remediation call from your agent                            | one pending proposal for a stored finding, inside the action list                    |
| `refuse-without-approval`   | 10      | an attempt to run the change before approval                          | a remediation_refused row and the same booking-web image as before                   |
| `approve-with-blast-radius` | 15      | your approval after reading evidence and blast radius                 | a remediation_approved row naming the approver, after the pending row                |
| `roll-back-the-release`     | 15      | the approved rollback, run and verified                               | executed then verification_passed rows; the footer reads Release v1                  |
| `edit-the-wrong-fix`        | 20      | for timetable-hang: reject the rollback, edit to a restart, approve   | event order pending, rejected, pending, approved, executed; timetable-loader healthy |
| `add-the-config-rollback`   | 25      | rollback_config in the action list, with blast radius text and a test | policy test passes, an unknown file is refused, fare-file-push resolves through it   |

## `parts/06-write-it-down`

Write it down without blame. 3 steps, 50 minutes, skeleton: README only.

| Step                    | Minutes | The learner produces                                     | The check reads                                                                 |
| ----------------------- | ------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `draft-the-timeline`    | 15      | `postmortems/bad-release.md` timeline from the audit log | every timestamp matches an audit row, and nothing in it lacks a row             |
| `write-the-postmortem`  | 25      | the full postmortem                                      | required sections, Impact numbers from Postgres, no person named in Root causes |
| `file-the-action-items` | 10      | `postmortems/actions.yaml`                               | each item has an owner, a due marker and a link to the eval case it adds        |

## `parts/07-prove-the-ai-sre-right`

Prove the AI SRE is right. 5 steps, 100 minutes, skeleton: README only.

| Step                     | Minutes | The learner produces                                            | The check reads                                                                     |
| ------------------------ | ------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `build-the-incident-set` | 20      | `evals/incidents/` with the given scenarios and one of your own | each ground-truth.json validates; your case plants and the reference query finds it |
| `score-the-ai-sre`       | 20      | a scored run of your agent over the set                         | report file; code checks decide each case, three replay runs per case               |
| `check-the-judge`        | 25      | 20 hand labels, split into dev and test                         | judge TPR and TNR on the test half, both at least 0.9                               |
| `catch-the-injection`    | 15      | the injection case in the set                                   | zero executed actions and the proposal refused                                      |
| `gate-the-prompt-change` | 20      | a change to your agent compared with the baseline               | per-case deltas; fails if any case drops                                            |

## Notes for the part sessions

- `know-when-it-is-broken` needs a `noisy-morning` recording (`bun run world break noisy-morning`, wait, `bun run record noisy-morning 40`). The detector lives in `world/harbour-control/harbour_control/detector.py` and `sql/02-anomaly.sql`.
- `look-without-touching`: the brief's mcp-clickhouse server is not in the world; HyperDX's built-in MCP and harbour-control's read tools cover both read paths. Add it only if the step needs raw SQL through MCP.
- `say-what-broke`: grade the finding against `world/scenarios/<scenario>.json` and the `code` in `world/.state/scenario.json`; the reference cassette `agent/cassettes/bad-release.json` passes. `refuse-the-guess` is the free lesson in value.md.
- `ask-before-you-act`: the finished policy already has `rollback_config`; the step's starter must be a policy without it, run through `bun run world try`-style mounting or the harbour-control unit tests (`cd world/harbour-control && uv run pytest`).
- `write-it-down` and `ask-before-you-act` have no verified company number yet: every host with one (sre.google, aws.amazon.com, blog.cloudflare.com, engineering.fb.com, grafana.com, arxiv.org) was blocked on the build date.
- `prove-the-ai-sre-right`: the contract for headless runs is `evals/agent.toml` naming a command, as the brief says; ground truth layout follows ClickStack's hdx-eval scenarios.

## `parts/08-do-it-with-the-tools-teams-run`

Do it with the tools teams run. 1 step, 20 minutes, optional in the room and expected as homework.

| Step                    | Minutes | The learner produces | The check reads                                                          |
| ----------------------- | ------- | -------------------- | ------------------------------------------------------------------------ |
| `trace-the-model-calls` | 20      | `genai.ts`           | the spans of one pretend incident, then a ClickStack-style query on them |

The homework copy lives in `assignment/`: its starter `genai.ts`, `check.ts`, `compose.yml` and `result.json` output. The reference solution is the step's `solution/`.
