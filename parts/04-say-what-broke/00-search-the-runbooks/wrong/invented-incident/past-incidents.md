# Past incidents

## inc-0207 Disk filled by logs

Cause: a debug setting wrote huge log files. Fixed by removing the setting.

## inc-0312 Bookings failed after a release

Cause: the release did not give database connections back, so no connection slots were left. Fixed by rolling back.

## inc-0415 Certificate ended

Cause: nobody renewed it. Fixed by renewing it.
