# Deploy Cadence (home server + Cloudflare DNS, no Zero Trust)

Public URL: `https://cadence.bardiamardan.xyz`

You do **not** need Cloudflare Zero Trust (and no credit card).  
Use the free Cloudflare DNS plan + a small DDNS script + router port forward.

## Why not Vercel / Zero Trust?

- **Vercel**: can’t run Postgres, Redis, MinIO, WebSockets, or ffmpeg.
- **Zero Trust / Tunnel**: nice, but the free signup often demands a card. Skip it.

## Architecture

```
Friends → HTTPS → Cloudflare (free proxy)
                 → HTTP → your public IP:80
                 → router forward → 192.168.100.100:80
                 → Caddy → web / api / minio
```

Your ISP can change the public IP; the DDNS script updates the Cloudflare A record every few minutes.

---

## Step 1 — Cloudflare DNS (free, no card)

1. Open [dash.cloudflare.com](https://dash.cloudflare.com) → zone **`bardiamardan.xyz`**
2. **SSL/TLS** → Overview → encryption mode **Flexible**  
   (Cloudflare gives visitors HTTPS; your server only needs port 80 for now.)
3. **SSL/TLS** → Edge Certificates → **Always Use HTTPS** = On
4. **DNS** → **Records** → **Add record**:

| Type | Name | IPv4 address | Proxy status |
| --- | --- | --- | --- |
| A | `cadence` | your current public IP (see below) | **Proxied** (orange cloud) |

Find your public IP on your Mac:

```bash
curl -4 https://api.ipify.org; echo
```

Right now it was roughly `91.107.255.53` — re-check before saving; ISPs change it.

---

## Step 2 — Cloudflare API token (for DDNS only)

1. [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Use template **Edit zone DNS**
3. Zone Resources → Include → Specific zone → **`bardiamardan.xyz`**
4. Continue → Create → **copy the token once** (you won’t see it again)

Get Zone ID + Record ID (on your Mac):

```bash
export CF_API_TOKEN='paste-token-here'

# Zone ID
curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=bardiamardan.xyz" \
  | jq -r '.result[0].id'

# Record ID (after you created the A record)
export CF_ZONE_ID='paste-zone-id'
curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?name=cadence.bardiamardan.xyz" \
  | jq -r '.result[0].id'
```

---

## Step 3 — Router port forward

On the home gateway (`192.168.100.1`):

| External port | Protocol | Internal IP | Internal port |
| --- | --- | --- | --- |
| **80** | TCP | **192.168.100.100** | **80** |

You do **not** need 443 on the router while SSL mode is **Flexible**.

Optional later (harder, better): Cloudflare Origin Certificate + Full SSL + forward 443.

---

## Step 4 — DDNS on the server

```bash
ssh cursor@192.168.100.100

sudo mkdir -p /etc/cadence
sudo tee /etc/cadence/cf-ddns.env >/dev/null <<'EOF'
CF_API_TOKEN=paste-token-here
CF_ZONE_ID=paste-zone-id
CF_RECORD_ID=paste-record-id
CF_RECORD_NAME=cadence.bardiamardan.xyz
EOF
sudo chmod 600 /etc/cadence/cf-ddns.env

sudo install -m 755 ~/cadence/deploy/cf-ddns.sh /usr/local/bin/cf-ddns.sh
sudo apt-get update && sudo apt-get install -y jq curl

# test once
sudo /usr/local/bin/cf-ddns.sh

# every 5 minutes
echo '*/5 * * * * root /usr/local/bin/cf-ddns.sh >> /var/log/cf-ddns.log 2>&1' \
  | sudo tee /etc/cron.d/cf-ddns
sudo chmod 644 /etc/cron.d/cf-ddns
```

---

## Step 5 — App stack (already deployed)

Cadence is installed under `~/cadence` with a **fresh empty database**.

```bash
cd ~/cadence
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod ps
curl -sS http://127.0.0.1/readyz
```

Expose / refresh Caddy on host port 80:

```bash
cd ~/cadence
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d caddy
```

Open:

- LAN: `http://192.168.100.100/`
- Internet (after DNS + forward): `https://cadence.bardiamardan.xyz`

Register a new username (DB starts empty).

---

## Checklist if the site doesn’t load

1. DNS: `dig +short cadence.bardiamardan.xyz` → Cloudflare anycast IPs (not your home IP) when Proxied
2. Router: port 80 → `192.168.100.100:80`
3. Server: `curl -sS http://127.0.0.1/readyz` → `ok`
4. From outside (phone LTE): `https://cadence.bardiamardan.xyz`
5. Cloudflare SSL mode = **Flexible**
6. DDNS log: `sudo tail /var/log/cf-ddns.log`

---

## Security notes

- Change the weak SSH password on the server.
- Prefer SSH keys.
- Cloudflare proxy hides your real home IP from casual scanners (good).
- Still: only forward port 80, keep SSH off the internet if you can (or change port / allowlist).
