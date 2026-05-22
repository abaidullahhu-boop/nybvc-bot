# Outbound Egress Strategy (DOB NOW Scraper)

This service scrapes DOB NOW and can be blocked by Akamai. To reduce bans and make recovery quick, outbound traffic is controlled via Cloud NAT with a small static IP pool and optional proxy fallback.

## Current setup (us-east1)

- VPC: `bot-egress`
- Subnet: `bot-egress-subnet` (10.8.0.0/28)
- Cloud Router/NAT: `bot-nat-router` + `bot-nat`
- NAT IP pool (round-robin, project `ny-building-bot-496807`):
  - `bot-egress-ip` → 34.138.66.227
  - `bot-egress-ip-2` → 34.139.46.21
  - `bot-egress-ip-3` → 34.24.224.124
- Serverless VPC connector: `bot-serverless-conn` (10.8.1.0/28) — attached to Cloud Run with `vpc-egress=all-traffic`.

## How Cloud Run is deployed

- `.github/workflows/deploy-cloud-run.yml` deploys with `--vpc-connector bot-serverless-conn --vpc-egress all-traffic` so all egress uses the NAT pool.
- The scraper will auto-use an HTTP/HTTPS proxy if the env vars are set (see "Proxy fallback").

## Common operations

### Add another static IP to the pool

```
gcloud compute addresses create bot-egress-ip-4 --region us-east1
gcloud compute routers nats update bot-nat --router bot-nat-router --region us-east1 \
  --nat-external-ip-pool=bot-egress-ip,bot-egress-ip-2,bot-egress-ip-3,bot-egress-ip-4
```

### Remove a blocked IP from the pool

```
gcloud compute routers nats update bot-nat --router bot-nat-router --region us-east1 \
  --nat-external-ip-pool=bot-egress-ip-2,bot-egress-ip-3   # example: drop the first IP
```

### Verify NAT config

```
gcloud compute routers describe bot-nat-router --region us-east1 \
  --format='get(nats[0].natIps)'
```

### Verify Cloud Run is using the connector

```
gcloud run services describe nyc-building-bot --region us-east1 \
  --format='value(status.latestReadyRevisionName, spec.template.metadata.annotations."run.googleapis.com/vpc-access-connector")'
```

## Proxy fallback (optional)

- The scraper respects `HTTP_PROXY` / `HTTPS_PROXY`. Leave them empty under normal conditions.
- If Akamai blocks all NAT IPs, set GitHub secrets `HTTP_PROXY` and `HTTPS_PROXY` (e.g., a residential proxy URL) and re-run the workflow; Cloud Run will pick them up from `.env.yaml`.

## Detection/alerting idea

- The scraper logs a screenshot and HTML snippet when "Access Denied" is encountered. You can add a Cloud Logging alert on the text `Access Denied` to know when an IP in the pool gets blocked.

## Quick recovery checklist

1. If you see `Access Denied`, check logs for the screenshot path to confirm.
2. Remove the suspected IP from the NAT pool or add a fresh one, then run the update command above.
3. If blocks persist, switch to the proxy by setting `HTTP_PROXY/HTTPS_PROXY` secrets and redeploy with the GitHub Action.

