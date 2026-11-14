# Runbooks

## Runbook: Database connections run out

Symptoms: errors say remaining connection slots are reserved. Bookings fail after a release.
First move: compare errors by release. If one release is worse, roll it back.

## Runbook: Disk is almost full

Symptoms: writes fail with no space left on device. Logs stop arriving.
First move: remove old files, then find what grows.

## Runbook: Certificate is close to expiry

Symptoms: browsers warn about a certificate that is about to end.
First move: renew the certificate and reload the web server.
