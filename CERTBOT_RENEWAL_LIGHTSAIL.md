# Renew HTTPS on HIUSA Lightsail

This is for the HIUSA site running on a Lightsail **static IPv4 address**, with Nginx and no Docker or domain. Run every command below in the **Lightsail SSH terminal**, not in PowerShell on your PC. These instructions were checked against the official Certbot, Let's Encrypt, and AWS docs on 2026-09-28.

For normal renewal, you do **not** type a certificate name, domain, IP, webroot path, or email into the Certbot commands. Certbot reads those details from the certificate's saved renewal configuration. The only thing you type is your static IP when Step 1 prompts for it; that is used to check the live website.

## 1. Connect and enter your static IP once

Open the Lightsail console, select the HIUSA instance, and click **Connect using SSH**. Paste this command:

```bash
read -r -p 'Paste your Lightsail static IPv4: ' SITE_IP
```

When the cursor waits, paste **only the IP address**, such as `203.0.113.10`, then press Enter. The example is not your IP. Do not include `https://`, `/`, quotes, or angle brackets. You never need to replace `$SITE_IP` in later commands: the SSH shell fills it in. If you close SSH and reconnect, run this step again.

## 2. Check that Certbot manages the certificate Nginx uses

```bash
sudo nginx -t
sudo nginx -T 2>/dev/null | grep -E 'ssl_certificate|listen 443'
sudo certbot certificates
```

Continue only if `nginx -t` succeeds, the Nginx `ssl_certificate` path starts with `/etc/letsencrypt/live/`, and `certbot certificates` shows that same **Certificate Path**. For example, if Nginx uses `/etc/letsencrypt/live/203.0.113.10/fullchain.pem`, Certbot must list that path. The IP here is just an example; yours will differ.

If Certbot says **No certificates found**, or Nginx uses another certificate path, **stop here**. `certbot renew` cannot renew a certificate it does not manage. See Step 7 if this is a first-time IP certificate setup. If you are unsure what the output means, save the output of these three commands before changing anything.

## 3. Test renewal safely

```bash
sudo certbot renew --dry-run
```

Wait for the result. Continue only if Certbot reports that the test renewals succeeded. The dry run does not replace your live certificate. If it fails, do not run Step 4 yet; see **If the dry run fails** below.

## 4. Run renewal and check the live site

```bash
sudo certbot renew
sudo certbot certificates
sudo nginx -t && sudo systemctl reload nginx
curl -Iv "https://$SITE_IP/"
```

Run each command in order and stop if one fails. The `&&` reloads Nginx only when its configuration test passes. `curl` should connect over HTTPS without a certificate verification error. You can also open `https://` followed by your static IP in a browser.

`certbot renew` renews certificates that are **due**. It may say nothing was renewed because the certificate is not due yet; that is normal. Read the **Expiry Date** from `sudo certbot certificates`. Do not use `--force-renewal` just to make the date change.

## 5. Make sure future renewals happen automatically

IP certificates from Let's Encrypt last **160 hours** (a little under seven days). A monthly manual command is not enough. Check the scheduler and the Nginx reload hook:

```bash
systemctl list-timers --all | grep -i certbot
systemctl list-unit-files '*certbot*timer'
sudo ls -l /etc/letsencrypt/renewal-hooks/deploy/
```

Look for `certbot.timer` **or** `snap.certbot.renew.timer`. Either one is enough. The first command shows scheduled timers; the second also shows installed timers that are disabled. You do not need both. If one exists but is disabled, enable **only that existing timer**:

```bash
sudo systemctl enable --now certbot.timer
```

Use the command above only when the listed timer is `certbot.timer`. If the listed timer is `snap.certbot.renew.timer`, use this instead:

```bash
sudo systemctl enable --now snap.certbot.renew.timer
```

If neither timer exists, check whether your installation uses cron:

```bash
sudo grep -R 'certbot.*renew' /etc/cron.d /etc/crontab
```

Look for an active cron command, not just a commented-out example. If neither a timer nor a cron renewal job exists, automatic renewal is **not confirmed**. Check [Certbot's installation instructions](https://certbot.eff.org/instructions) for the method used on this server before adding a scheduler. Do not add a second scheduler when one is already working.

The deploy-hook directory should contain an executable hook that reloads Nginx after a successful renewal. If one already does that, keep it. If there is **no** Nginx reload hook, create one:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo nano /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Paste exactly this into `nano`:

```sh
#!/bin/sh
set -eu
nginx -t
systemctl reload nginx
```

Save with **Ctrl+O**, Enter, then **Ctrl+X**. Make the hook executable and test it:

```bash
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run --run-deploy-hooks
```

The hook runs after a successful live renewal. `--run-deploy-hooks` also runs it during this dry-run test. The Nginx reload does not restart the HIUSA application.

## 6. Check after the next automatic renewal

In a few days, reconnect by SSH, repeat Step 1, then run:

```bash
sudo certbot certificates
curl -Iv "https://$SITE_IP/"
```

Check that the expiry date moved forward and HTTPS still verifies. If it did not, inspect the renewal log:

```bash
sudo journalctl -u certbot.service -u snap.certbot.renew.service -n 100 --no-pager
sudo tail -n 100 /var/log/letsencrypt/letsencrypt.log
```

One of the two service names may not exist on your installation; that part of the journal output can be ignored.

## If the dry run fails

Do not force a live renewal. Check these items in order:

1. In the Lightsail instance's **Networking** tab, confirm the IPv4 firewall allows inbound HTTP TCP **80** and HTTPS TCP **443**. The static IP must still be attached to this instance.
2. Run `sudo ufw status` and `sudo systemctl is-active nginx`. If UFW is active, it must also allow HTTP and HTTPS. Nginx must be running.
3. Run `sudo nginx -T 2>/dev/null | grep -A12 -B3 'acme-challenge'`. The port-80 Nginx server must serve `/.well-known/acme-challenge/` from the same webroot used by Certbot. If the output shows no challenge location, inspect your existing Nginx site before changing it.
4. Check which renewal method Certbot saved with `sudo grep -HnE 'authenticator|webroot' /etc/letsencrypt/renewal/*.conf`. This prints matching lines and filenames without asking you to guess a certificate name. Do **not** edit these `.conf` files directly. If the webroot must change, use [Certbot's `reconfigure` procedure](https://eff-certbot.readthedocs.io/en/stable/using.html#modifying-the-renewal-configuration-of-existing-certificates).

For HIUSA, the ACME webroot should be outside `/var/www/hiusa/client/dist`, for example `/var/www/letsencrypt`. Vite clears `dist` during builds, which caused the earlier `EACCES ... dist/.well-known/acme-challenge` error. Moving an existing ACME webroot requires updating both Nginx and Certbot's saved renewal configuration; do not change one without the other.

## 7. If there is no Certbot-managed IP certificate yet

This is **first-time certificate setup**, not renewal. Use it only if Step 2 showed that Certbot does not manage the certificate used by Nginx. If another certificate service is already in use, identify it before replacing anything.

1. Confirm you are using a static IPv4 address and that Certbot is version **5.4 or newer**:

   ```bash
   certbot --version
   ```

   If older, follow the [official Certbot installation instructions](https://certbot.eff.org/instructions) for your Ubuntu/Nginx installation. The `--ip-address` webroot method requires Certbot 5.4 or newer.

2. Configure the port-80 Nginx server to serve the ACME challenge from `/var/www/letsencrypt`, **not** from `client/dist`. The exact fresh-server Nginx setup is in [Phase 7 of the HIUSA Lightsail guide](LIGHTSAIL_DEPLOYMENT_AND_MAINTENANCE.md). On an existing server, inspect and edit its existing Nginx site instead of creating a conflicting second one.

3. After the port-80 configuration is in place, run:

   ```bash
   sudo install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot certonly --staging --preferred-profile shortlived --webroot --webroot-path /var/www/letsencrypt --ip-address "$SITE_IP"
   ```

   Stop if the Nginx test fails. The staging certificate tests issuance but is **not browser-trusted**. When staging succeeds, request the real certificate:

   ```bash
   sudo certbot certonly --preferred-profile shortlived --webroot --webroot-path /var/www/letsencrypt --ip-address "$SITE_IP"
   sudo certbot certificates
   ```

4. Add the exact **Certificate Path** and **Private Key Path** shown by Certbot to the Nginx HTTPS server block. Phase 7 of the Lightsail guide shows where. The path will typically be `/etc/letsencrypt/live/<your IP>/fullchain.pem`, but use the path Certbot actually printed. Then run `sudo nginx -t`, reload Nginx if valid, and complete Steps 3 through 6 above.

## Sources

- [Let's Encrypt: IP certificates, Certbot version, and webroot issuance](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
- [Let's Encrypt: 160-hour IP certificate lifetime](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Certbot: renewal, dry runs, hooks, and automation](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)
- [AWS Lightsail: HTTP/HTTPS firewall rules](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
