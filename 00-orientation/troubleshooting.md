# When something goes wrong

Every message a script prints on failure is in this table.

| What you see | What it means | Fix |
|---|---|---|
| `There is no step called "..."` | The step name is misspelled. | Copy a name from the list it prints. |
| `There is no part called "..."` | The part name is misspelled. | Copy a name from the list it prints. |
| `ERROR the check for ... could not load` | The check itself is broken, not your work. | Open an issue with the full output. |
| `bun: command not found` | Bun is not installed. | Install it from bun.sh, then open a new terminal. |
| `Docker is not running.` | The Docker daemon is not up. | Start Docker Desktop or the docker service, then run `bun run world` again. |
| `Docker has ... GB of memory. The world needs at least 4 GB` | ClickHouse would be killed for memory. | Raise the memory in Docker Desktop, Settings, Resources. |
| `The world could not do that: docker compose ... failed` | A container did not start or did not become healthy. | Run `bun run world status`, then `docker compose -p gullrock logs <service>` for the one that is not healthy. |
| `HyperDX refused to create the on-call account` | ClickStack started from an old data volume. | Run `bun run world reset`. |
| `ClickStack ingest did not become ready within 120 s` | The collector has not loaded the ingestion key yet. | Run `bun run world` again; it waits again. |
| `There is no scenario called "..."` | `bun run world break` got an unknown name. | Use one it lists: bad-release, timetable-hang, fare-file-push, noisy-morning, injection. |
| `No incident opened.` | The detector did not page within 3 minutes. | Check `bun run world status`; a page needs traffic, so wait until passengers is running. |
| `Waiting for a human: approve at ...` | Not an error: the AI SRE proposed a change and is waiting for you. | Read it, then `bun run approve --yes` or click Approve. |
| `Nothing is waiting for approval.` | No pending change exists. | Run `bun run demo bad-release` first. |
| `Could not sign in to Harbour Control.` | harbour-control is down or `.env` changed. | Run `bun run world status`. |
| `No open incident has an approved change.` | `bun run demo finish` found nothing to run. | Approve first: `bun run approve --yes`. |
| `Recovery was not verified within 4 minutes.` | The change ran but the error rate stayed above its bound. | Open http://localhost:8090 and read the verification row. |
| `LLM_PROVIDER=... needs ..._API_KEY in .env` | A live provider has no key. | Put the key in `.env` (never on a command line), or set `LLM_PROVIDER=replay`. |
| `LLM_PROVIDER=... is not one of ...` | The provider name is wrong. | Use replay, anthropic, openrouter, openai or ollama. |
| `... role(s) failed. Check LLM_PROVIDER and its key in .env.` | `bun run models` could not reach a model. | Check the key and the provider; replay never fails. |
| `the world is not running: bun run world` | A check reads the live world and found no ClickHouse. | Start the world, or read the step's notes on recorded checks. |
| `FAIL ...` with `Try next: ...` | One rule of a step check failed. | Do what the Try next line says, then run the check again. |
