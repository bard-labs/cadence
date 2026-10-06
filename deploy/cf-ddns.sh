#!/usr/bin/env bash
# Update a Cloudflare A record to the current public IPv4.
# Requires: curl, jq
# Env file: /etc/cadence/cf-ddns.env
set -euo pipefail

ENV_FILE="${CF_DDNS_ENV:-/etc/cadence/cf-ddns.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${CF_API_TOKEN:?}"
: "${CF_ZONE_ID:?}"
: "${CF_RECORD_ID:?}"
: "${CF_RECORD_NAME:?}"

# Prefer services that work on Iranian networks; api.ipify.org often times out.
IP=""
for url in \
  https://icanhazip.com \
  https://checkip.amazonaws.com \
  https://api.ipify.org
do
  if IP="$(curl -4 -fsS --max-time 10 "$url" | tr -d '[:space:]')"; then
    [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
  fi
  IP=""
done
if [[ ! "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "$(date -Is) could not detect public IPv4" >&2
  exit 1
fi

CUR="$(curl -fsS --max-time 15 \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${CF_RECORD_ID}" \
  | jq -r '.result.content')"

if [[ "$IP" == "$CUR" ]]; then
  echo "$(date -Is) ok ${CF_RECORD_NAME}=${IP}"
  exit 0
fi

curl -fsS --max-time 15 -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${CF_RECORD_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"A\",\"name\":\"${CF_RECORD_NAME}\",\"content\":\"${IP}\",\"ttl\":120,\"proxied\":true}" \
  | jq -e '.success == true' >/dev/null

echo "$(date -Is) updated ${CF_RECORD_NAME} ${CUR} -> ${IP}"
