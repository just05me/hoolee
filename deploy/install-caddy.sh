#!/bin/sh
# Run on the existing host after deploying /opt/hoolee.
set -eu
main=/etc/caddy/Caddyfile
site=/etc/caddy/sites-enabled/hoolee.caddy
backup="${main}.hoolee-backup-$(date +%Y%m%d%H%M%S)"
sudo cp "$main" "$backup"
if sudo test -f "$site"; then sudo cp "$site" "${backup}.site"; fi
sudo install -m 644 /opt/hoolee/deploy/Caddyfile.snippet "$site"
if ! sudo grep -q '^import /etc/caddy/sites-enabled/hoolee.caddy$' "$main"; then
  printf '\nimport /etc/caddy/sites-enabled/hoolee.caddy\n' | sudo tee -a "$main" >/dev/null
fi
if sudo caddy validate --config "$main" --adapter caddyfile; then
  sudo systemctl reload caddy
else
  sudo cp "$backup" "$main"
  if sudo test -f "${backup}.site"; then sudo cp "${backup}.site" "$site"; else sudo rm -f "$site"; fi
  exit 1
fi
