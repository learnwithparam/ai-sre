# Postmortem: bad release of booking-web

Incident: inc-b1182f037ed0

## Timeline

All times are UTC. Each line is one row of the audit log.

- 22:17:52 incident_opened: the detector paged on-call; the booking-web error rate was 10% over the last minute.
- 22:18:01 finding_submitted: the AI SRE blamed release v2 of booking-web and cited three traces.
- 22:18:01 remediation_proposed: the AI SRE proposed one change, a rollback of booking-web to v1.
- 22:18:01 remediation_refused: the AI SRE tried to run the rollback before approval; harbour-control refused.
- 22:18:05 remediation_edited: the on-call engineer checked the dashboards before approving.
- 22:18:08 remediation_approved: the on-call engineer read the evidence and approved the rollback.
- 22:18:24 remediation_executed: the rollback ran; booking-web restarted on release v1.
- 22:19:33 verification_passed: a full minute of fresh traffic had no booking errors.
- 22:19:33 incident_resolved: harbour-control closed the incident.
