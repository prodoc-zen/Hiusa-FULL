# Server templates

These files mirror what runs on the production Lightsail instance, rebuilt from `docs/native-lightsail-deployment.md` and `LIGHTSAIL_DEPLOYMENT_AND_MAINTENANCE.md`. They are templates: placeholders stand where a secret or a host value goes, and nothing here holds a secret. The instance itself was not copied, so compare with `sudo systemctl cat <unit>` and `sudo nginx -T` before you install anything over a working server.

| File | Install as |
|---|---|
| `hiusa-artisan` | `/usr/local/bin/hiusa-artisan`, mode 755. Run it as `www-data` so config caches keep the native overrides. |
| `laravel-native.env.example` | `/etc/hiusa/laravel-native.env`, root:www-data, mode 640, with real values filled in. |
| `systemd/hiusa-*.service` | `/etc/systemd/system/` |
| `systemd/hiusa-ops-check.timer` | `/etc/systemd/system/`, next to `hiusa-ops-check.service`. See "Watching the queue and scheduler". |
| `systemd/*.service.d/native-env.conf` | `/etc/systemd/system/<unit>.service.d/`, so FPM, the queue and the scheduler load the overrides. |
| `nginx/hiusa.conf` | `/etc/nginx/sites-available/hiusa` |
| `php/20-hiusa.ini` | `/etc/php/8.3/fpm/conf.d/20-hiusa.ini` |

Differences from the unit files in the guide: the queue and scheduler units have `RestartSec=5` and `StartLimitIntervalSec=0` (the latter under `[Unit]`, where systemd reads it), so a crash while MySQL restarts does not leave a unit failed for good, and the queue worker runs with `--timeout=60`, below the 90 second `retry_after` in `server/config/queue.php`. The nginx `/index.php` location repeats the 110M body limit because nginx checks the limit again after the internal rewrite.

Also not captured here: the FPM pool overrides that expose the AI settings to PHP workers and the Certbot deploy hook. Copy them from the instance.

After installing the units, run `sudo systemctl daemon-reload` and `sudo systemctl enable --now hiusa-ai hiusa-fingerprint hiusa-queue hiusa-scheduler`, then `systemctl is-enabled` on each so a reboot brings them back.

## Watching the queue and scheduler

`sudo -u www-data /usr/local/bin/hiusa-artisan hiusa:ops-check` prints a plain line and exits non-zero when there are failed jobs, the oldest pending job has waited over 15 minutes, or the scheduler has not run in 5 minutes. Run it from cron or an uptime monitor and alert on a non-zero exit.

To have the server run that check for you every 5 minutes, install the timer. The check unit exits non-zero on a problem, so systemd marks it failed:

```
sudo cp scripts/server/systemd/hiusa-ops-check.service scripts/server/systemd/hiusa-ops-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hiusa-ops-check.timer
```

To see a failure, run `systemctl --failed`: `hiusa-ops-check.service` is listed while the last check found a problem. `journalctl -u hiusa-ops-check.service -n 20` shows the plain line that says what is wrong. The unit clears itself from the list on the next check that passes. `systemctl list-timers hiusa-ops-check.timer` shows when it last ran and when it runs next.
