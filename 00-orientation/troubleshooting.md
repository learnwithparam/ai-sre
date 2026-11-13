# When something goes wrong

Every message a script prints when something fails is in this table. Find the message you see in the first column. Then read what it means and how to fix it.

For example, you run `bun run verify meet-the-harbour` and you see:

```text
  FAIL  the booking is a row in the bookings table
        Try next: copy the reference the booking page showed after Book and pay; check it with bun run world status running
```

The last row of the table matches this message. So you do what the Try next line says, and you run the check again.

| What you see                                                  | What it means                                                         | Fix                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `There is no step called "..."`                               | You typed a step name that does not exist.                            | Copy a name from the list it prints.                                                                                  |
| `There is no part called "..."`                               | You typed a part name that does not exist.                            | Copy a name from the list it prints.                                                                                  |
| `ERROR the check for ... could not load`                      | The check itself is broken. Your work is not the problem.             | Open an issue with the full output.                                                                                   |
| `bun: command not found`                                      | Bun is not installed.                                                 | Install it from bun.sh. Then open a new terminal.                                                                     |
| `Docker is not running.`                                      | The Docker service is not running.                                    | Start Docker Desktop or the docker service. Then run `bun run world` again.                                           |
| `Docker has ... GB of memory. The world needs at least 4 GB`  | ClickHouse would stop when it runs out of memory.                     | Give Docker more memory in Docker Desktop, Settings, Resources.                                                       |
| `The world could not do that: docker compose ... failed`      | A container did not start, or it started but is not healthy.          | Run `bun run world status`. Then run `docker compose -p gullrock logs <service>` for the service that is not healthy. |
| `HyperDX refused to create the on-call account`               | ClickStack started with old data from an earlier run.                 | Run `bun run world reset`.                                                                                            |
| `ClickStack ingest did not become ready within 120 s`         | The collector has not loaded its ingestion key yet.                   | Run `bun run world` again. It waits again.                                                                            |
| `There is no scenario called "..."`                           | `bun run world break` got a name it does not know.                    | Use one it lists: bad-release, timetable-hang, fare-file-push, noisy-morning, injection.                              |
| `No incident opened.`                                         | The detector did not send a page within 3 minutes.                    | Run `bun run world status`. A page needs traffic, so wait until passengers is running.                                |
| `Waiting for a human: approve at ...`                         | This is not an error. The AI SRE proposed a change and waits for you. | Read the change. Then run `bun run approve --yes` or click Approve.                                                   |
| `Nothing is waiting for approval.`                            | No change is waiting for you.                                         | Run `bun run demo bad-release` first.                                                                                 |
| `Could not sign in to Harbour Control.`                       | harbour-control is not running, or `.env` changed.                    | Run `bun run world status`.                                                                                           |
| `No open incident has an approved change.`                    | `bun run demo finish` found no approved change to run.                | Approve a change first: `bun run approve --yes`.                                                                      |
| `Recovery was not verified within 4 minutes.`                 | The change ran, but the error rate stayed above its limit.            | Open http://localhost:8090 and read the verification row.                                                             |
| `LLM_PROVIDER=... needs ..._API_KEY in .env`                  | You chose a live model provider, but it has no key.                   | Put the key in `.env`, never on a command line. Or set `LLM_PROVIDER=replay`.                                         |
| `LLM_PROVIDER=... is not one of ...`                          | The provider name is wrong.                                           | Use replay, anthropic, openrouter, openai or ollama.                                                                  |
| `... role(s) failed. Check LLM_PROVIDER and its key in .env.` | `bun run models` could not reach a model.                             | Check the key and the provider. Replay never fails.                                                                   |
| `the world is not running: bun run world`                     | The check reads the live world, but it found no ClickHouse.           | Start the world with `bun run world`. Or read the step's notes on recorded checks.                                    |
| `FAIL ...` with `Try next: ...`                               | One rule of a step check failed.                                      | Do what the Try next line says. Then run the check again.                                                             |
