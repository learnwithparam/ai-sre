# Postmortem: bad release of booking-web

Incident: inc-b1182f037ed0

## Summary

Release v2 of booking-web opened a new database connection for each booking's audit trail and held it. Only two audit connections may be open, so about one booking in five failed. A human approved a rollback to v1, and bookings recovered.

## Impact

Impact started: 22:10:35
Impact ended: 22:18:24
Failed bookings: 131
Bookings confirmed: 513

For almost eight minutes, 131 passengers pressed Book and pay and got an error. Some of them may have phoned the port or given up on their sailing.

## Timeline

All times are UTC. Each line is one row of the audit log.

- 22:17:52 incident_opened: the detector paged on-call; the booking-web error rate was 10% over the last minute.
- 22:18:01 finding_submitted: the AI SRE blamed release v2 of booking-web and cited three traces.
- 22:18:01 remediation_proposed: the AI SRE proposed one change, a rollback of booking-web to v1.
- 22:18:01 remediation_refused: the AI SRE tried to run the rollback before approval; harbour-control refused.
- 22:18:08 remediation_approved: the on-call engineer read the evidence and approved the rollback.
- 22:18:24 remediation_executed: the rollback ran; booking-web restarted on release v1.
- 22:19:33 verification_passed: a full minute of fresh traffic had no booking errors.
- 22:19:33 incident_resolved: harbour-control closed the incident.

## Root causes

oncall@gullrock.test approved a release that was not load tested. The audit trail code in v2 opens a new connection for every booking and does not give it back. The audit pool allows two connections, so the third booking at the same moment waits and then fails. No test sends more than one booking at a time, so the leak passed review and the release checks.

## Trigger

Release v2 of booking-web went live at 22:10:35 and served its first booking.

## Resolution

The AI SRE proposed `rollback_release booking-web v1`. The on-call engineer approved it, and harbour-control ran it at 22:18:24. A full minute of fresh traffic then had no booking errors, so harbour-control resolved the incident at 22:19:33.

## Detection

The detector opened an incident at 22:13:10 and again at 22:15:21. Both times the error rate dipped under the bound, and the detector closed the incident by itself. The incident that stayed open came at 22:17:52, more than seven minutes after the impact started.

## Lessons learned

### What went well

- The AI SRE named the release and cited real traces within ten seconds of the page.
- harbour-control refused to run the rollback until a human approved it.

### What went wrong

- The detector closed two real incidents too early, because the error rate moved around its bound.
- No load test sends bookings at the same moment, so the connection leak was not found before release.

## Action items

- Give each audit trail connection back after the booking is written, and add a test that sends ten bookings at once.
- Keep an incident open until the error rate stays under its bound for a full minute.
- Add this incident to the evals as the case bad-release.
