# HIUSA EC2 deployment

This repository includes a single-instance production stack for Amazon Linux
2023. Docker Compose runs Caddy, the React build, Laravel/Apache, the FastAPI
decision service, MySQL, Laravel's scheduler, and its queue worker.

## Runtime layout

- Caddy is the only public container and binds ports 80/443.
- React is compiled with the same-origin API base `/api`.
- Caddy proxies `/api`, `/storage`, `/uploads`, and `/up` to Laravel.
- Laravel connects to MySQL and FastAPI over Docker's private network.
- MySQL, Laravel storage, public uploads, and Caddy certificates use named
  volumes and survive container replacement.
- Vite's fingerprinted `/assets/*` files are cached by browsers for one year.
- Recently viewed JSON tables are reused from a bounded 60-second in-memory
  browser cache. Successful writes and authentication changes clear it.
- Authenticated JSON reads use a 20-second private server cache keyed by
  organization, user, role, route, and query. Successful writes invalidate the
  organization's cached reads; binary downloads and error responses bypass it.
  The scheduler removes expired database-cache rows daily.
- Public, authenticated, write, authentication, password-recovery, and
  AI/report-generation requests have separate configurable rate limits.
- Production secrets are generated only on EC2 and are ignored by Git.

This is a practical single-server deployment, not a highly available one. The
EC2 instance and its attached storage remain a single point of failure. Use
automated EBS snapshots and copy application backups away from the instance.

## 1. EC2 and security group

Launch Amazon Linux 2023 with enough memory for PHP, MySQL, Python, and image
builds (4 GiB is a comfortable starting point). Use encrypted gp3 storage and
an Elastic IP.

Allow inbound:

- TCP 22 from the administrator's current IP only.
- TCP 80 from the internet.
- TCP 443 from the internet.

Do not expose ports 3306, 8000, 8001, or the internal container ports.

## 2. Install Docker

```bash
sudo yum update -y
sudo yum install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
```

Log out and reconnect, then verify:

```bash
docker info
```

Install Compose and verify it:

```bash
sudo dnf install -y docker-compose-plugin
docker compose version
```

If the Compose package is unavailable in the selected Amazon Linux repository,
use Docker's official manual plugin instructions.

## 3. Clone and perform the first deployment

Production requires a domain whose DNS record already points at the Elastic IP:

```bash
git clone YOUR_REPOSITORY_URL Hiusa-FULL
cd Hiusa-FULL
bash scripts/setup-ec2.sh hiusa.example.com
```

For a disposable demonstration using only an Elastic IP:

```bash
bash scripts/setup-ec2.sh http://YOUR_ELASTIC_IP --insecure-demo-only --seed-demo
```

A bare domain enables Caddy-managed HTTPS. Ports 80 and 443 must be reachable
and DNS must resolve to the instance. The setup script rejects HTTP unless the
explicit demo-only override is present. Never use real credentials, payment
artifacts, election data, or other production records in insecure demo mode.

The setup script:

1. Generates independent database, Laravel, and internal service secrets.
2. Optionally accepts a Groq key through hidden terminal input.
3. Builds the production images.
4. starts MySQL and FastAPI.
5. Runs Laravel migrations.
6. Starts the frontend, API, scheduler, and queue worker.
7. Optimizes Laravel and prints container status.

It refuses to replace existing environment files. Use the update script after
the first successful setup.

### Database initialization

By default, setup creates the schema but no demo organization or users. Restore
an existing production backup, or explicitly request the repository's known
demo accounts and sample data on a disposable/demo installation:

```bash
bash scripts/setup-ec2.sh http://YOUR_ELASTIC_IP --insecure-demo-only --seed-demo
```

Never use `--seed-demo` for a real production installation.

## 4. Verify

```bash
docker compose -f compose.production.yml ps
docker compose -f compose.production.yml logs --tail=100
curl -I https://hiusa.example.com
curl https://hiusa.example.com/up
curl https://hiusa.example.com/api/organizations
```

All six services should be running; MySQL, FastAPI, and Laravel should report
healthy. Test login, a direct dashboard-page refresh, and an image upload.
API responses include standard `RateLimit-*` headers. Cacheable authenticated
JSON reads also include `X-Cache: MISS` or `X-Cache: HIT`; browser revalidation
may return `304 Not Modified`. Tune the `API_RESPONSE_CACHE_*` and
`RATE_LIMIT_*` values in `server/.env.production` only if measured traffic
requires it, then run `php artisan config:cache` or redeploy.

## 5. Deploy updates

```bash
cd ~/Hiusa-FULL
bash scripts/deploy-ec2.sh
```

The update script creates a timestamped backup, performs a fast-forward Git
pull, rebuilds images, applies forward migrations, recreates services, refreshes
Laravel caches, and verifies the public health endpoint. It never deletes Docker
volumes. A source rollback does not undo a database migration; restore the
pre-deployment backup if an incompatible migration cannot be repaired forward.

## 6. Back up application data

```bash
bash scripts/backup-ec2.sh
```

The timestamped backup contains a transaction-consistent MySQL dump, Laravel
storage, public uploads, and SHA-256 checksums. Copy it off-instance. Also enable
automated EBS snapshots or AWS Backup; backups stored only on the same EC2 disk
do not protect against instance or volume loss.

## 7. Operations

```bash
# Status
docker compose -f compose.production.yml ps

# Follow logs
docker compose -f compose.production.yml logs -f

# Restart without deleting data
docker compose -f compose.production.yml restart

# Stop without deleting data
docker compose -f compose.production.yml down
```

Never run `docker compose down -v` against this deployment. The `-v` flag
removes the named volumes containing MySQL, uploads, and application storage.

## Production follow-ups

- Configure a real mail provider; the default production template logs email.
- Add the Groq key only in `server/.env.production` if narrative AI is required.
- Prefer RDS and S3 when the system needs independent data durability or more
  than one application host.
- Regularly test restoring both the SQL dump and upload archives.
