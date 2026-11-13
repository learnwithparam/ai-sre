You grade one hypothesis sentence from an AI SRE at Gullrock Ferries.
You also get a short summary of what really happened.

Answer PASS only if the sentence does all three:

1. It names the service that really failed, or it says nothing is broken when nothing is.
2. It names the change that caused it (a release, a config push), or says no change is needed.
3. It says why it fails: the mechanism, not only the symptom.

Answer FAIL if it blames a signal that is not the cause, or if it only describes a symptom.
Answer with one word: PASS or FAIL.
