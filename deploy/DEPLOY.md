# Deploy Cadence on a home Linux server (Cloudflare)

Public URL: `https://cadence.bardiamardan.xyz`

## Why not Vercel?

**Correct — we can’t put the whole app on Vercel.** Vercel is fine for the Next.js UI alone. Cadence also needs:

- Postgres + Redis
- MinIO (object storage) and browser uploads to it
- A long-running Go API with WebSockets
- An ffmpeg worker for HLS transcoding

Those need an always-on Linux box. Your home server + Cloudflare is the right setup.

## Recommended: Cloudflare Tunnel (safer than DDNS + port forward)

You do **not** open ports 80/443 on your router. You do **not** need a static IP. Cloudflare keeps a tunnel out from your server and maps `cadence.bardiamardan.xyz` to it. When your ISP changes your public IP, the tunnel reconnects by itself.

### A. Cloudflare DNS (once)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → select `bardiamardan.xyz`.
2. **DNS** → confirm the zone is **Active** (Cloudflare nameservers at your registrar).
3. You do **not** need to create an A record yourself if you use a Tunnel — the tunnel connector creates/updates the CNAME.

Optional hardening while you set this up:

- **SSL/TLS** → Overview → mode **Full** (Tunnel) or **Full (strict)** later
- **SSL/TLS** → Edge Certificates → **Always Use HTTPS** = On
- **SSL/TLS** → Edge Certificates → **Minimum TLS Version** = 1.2

### B. Create the Tunnel

1. Cloudflare Dashboard → **Zero Trust** (may ask to create a free team name once).
2. **Networks** → **Tunnels** → **Create a tunnel**.
3. Type: **Cloudflared**.
4. Name: `cadence-home` → Save.
5. Choose **Docker** as the install method. Copy the long `TUNNEL_TOKEN=eyJ...` value (or the token alone).
6. **Public Hostname** tab → **Add**:
   - Subdomain: `cadence`
   - Domain: `bardiamardan.xyz`
   - Type: `HTTP`
   - URL: `caddy:80`
   - Save

If the UI asks for a local service URL before the container network exists, set it to `http://caddy:80` after compose is up, or use `http://127.0.0.1:8088` if cloudflared runs in host mode. With this repo’s compose file, keep cloudflared on the same Docker network and use **`http://caddy:80`**.

### C. Server deploy (fresh DB)

```bash
# on your Mac, from the repo
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .next --exclude 'apps/web/.env.local' \
  ./ cursor@192.168.100.100:~/cadence/

ssh cursor@192.168.100.100
cd ~/cadence
cp deploy/.env.prod.example deploy/.env.prod
nano deploy/.env.prod   # paste secrets + CLOUDFLARE_TUNNEL_TOKEN

# fresh volumes = empty DB
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  --profile tunnel down -v

sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  --profile tunnel up -d --build
```

Check:

```bash
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod ps
curl -sS http://127.0.0.1:8088/readyz
curl -sSI https://cadence.bardiamardan.xyz | head
```

Open `https://cadence.bardiamardan.xyz/login` and register a new username (empty DB).

### D. Cloudflare access tips (optional but good)

- **Zero Trust → Access → Applications**: put `cadence.bardiamardan.xyz` behind an email OTP allowlist if you want only friends.
- Or leave it public and rely on Cadence’s username/password.

---

## Alternative: classic DDNS + router port forward

Use this only if you refuse Tunnel. It is **less safe** (opens 80/443 on your home IP).

### 1) Cloudflare API token

1. [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**.
2. Use template **Edit zone DNS**.
3. Zone Resources → Include → Specific zone → `bardiamardan.xyz`.
4. Create → copy the token once.

### 2) DNS record

DNS → Add record:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `cadence` | your current public IP | Proxied (orange cloud) |

### 3) Update IP when it changes (on the server)

```bash
sudo apt-get update && sudo apt-get install -y curl jq
sudo tee /usr/local/bin/cf-ddns.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TOKEN="YOUR_API_TOKEN"
ZONE_ID="YOUR_ZONE_ID"
RECORD_ID="YOUR_RECORD_ID"
NAME="cadence.bardiamardan.xyz"
IP=$(curl -4 -fsS https://api.ipify.org)
CUR=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  | jq -r '.result.content')
if [ "$IP" != "$CUR" ]; then
  curl -fsS -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"$NAME\",\"content\":\"$IP\",\"proxied\":true}" >/dev/null
  echo "$(date -Is) updated $NAME -> $IP"
else
  echo "$(date -Is) ok $IP"
fi
EOF
sudo chmod 700 /usr/local/bin/cf-ddns.sh
```

Get IDs:

```bash
# Zone ID: Cloudflare → domain → Overview → Zone ID
# Record ID:
curl -sS -H "Authorization: Bearer YOUR_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records?name=cadence.bardiamardan.xyz" \
  | jq '.result[0].id'
```

Cron every 5 minutes:

```bash
echo '*/5 * * * * root /usr/local/bin/cf-ddns.sh >> /var/log/cf-ddns.log 2>&1' \
  | sudo tee /etc/cron.d/cf-ddns
```

### 4) Router port forward

On `192.168.100.1` (your gateway):

| External | Internal IP | Internal port |
| --- | --- | --- |
| TCP 80 | 192.168.100.100 | 80 (or 8088) |
| TCP 443 | 192.168.100.100 | 443 (or terminate TLS on Cloudflare only) |

With Cloudflare orange-cloud proxy, browsers hit Cloudflare; Cloudflare connects to your home IP on **80/443**. Prefer Tunnel so you never open those ports.

SSL mode if using DDNS: **Full** only if origin has a cert; easier to keep Tunnel.

---

## Ops cheatsheet

```bash
cd ~/cadence
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod --profile tunnel logs -f api
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod --profile tunnel ps
# wipe library/users again
sudo docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod --profile tunnel down -v
```
