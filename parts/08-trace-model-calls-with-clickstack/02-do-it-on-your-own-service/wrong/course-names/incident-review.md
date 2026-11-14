# Incident review

Service: booking-web

## Evidence

- log | payments pod logs, search "timeout" | 2026-03-02 14:05
- deploy | release page, version 41 went out | 2026-03-02 13:58

## Review

Finding: Release 41 cut the database timeout, so slow card checks failed
Change: Put the database timeout back to its old value
Approver: Dana, the payments lead
Proof: The timeout errors in the pod logs drop to zero within ten minutes
