# My approval

Action id: act-f8c3206aec14
Evidence: 0140c241e40c8eaf043f9844d89613bf
Blast radius: Restarts one container. Requests in flight to it fail, and callers see errors until its health check passes.
Why I approve: The failing traces all run release v2 and end in pool exhausted errors, and v1 had none.
