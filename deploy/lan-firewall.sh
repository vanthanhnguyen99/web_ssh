#!/bin/sh
# Restrict this published Docker port only. UFW INPUT rules do not cover DNAT.
set -eu
. /etc/default/web-ssh-lan-firewall
LAN_CIDRS=${LAN_CIDRS:-${LAN_CIDR:-}}
: "${WORKSPACE_IP:?}" "${WORKSPACE_HTTPS_PORT:?}" "${LAN_CIDRS:?}"
chain=WEBSSH-LAN
ipt() { /usr/sbin/iptables -w 10 "$@"; }
if [ "${1:-apply}" = remove ]; then
  while ipt -C DOCKER-USER -p tcp -m conntrack --ctdir ORIGINAL \
    --ctorigdst "$WORKSPACE_IP" --ctorigdstport "$WORKSPACE_HTTPS_PORT" \
    -j "$chain" 2>/dev/null; do
    ipt -D DOCKER-USER -p tcp -m conntrack --ctdir ORIGINAL \
      --ctorigdst "$WORKSPACE_IP" --ctorigdstport "$WORKSPACE_HTTPS_PORT" \
      -j "$chain"
  done
  if ipt -S "$chain" >/dev/null 2>&1; then
    ipt -F "$chain"
    ipt -X "$chain"
  fi
  exit 0
fi
ipt -S "$chain" >/dev/null 2>&1 || ipt -N "$chain"
ipt -F "$chain"
for cidr in $LAN_CIDRS; do
  ipt -A "$chain" -s "$cidr" -j RETURN
done
ipt -A "$chain" -j DROP
if ! ipt -C DOCKER-USER -p tcp -m conntrack --ctdir ORIGINAL \
  --ctorigdst "$WORKSPACE_IP" --ctorigdstport "$WORKSPACE_HTTPS_PORT" \
  -j "$chain" 2>/dev/null; then
  ipt -I DOCKER-USER 1 -p tcp -m conntrack --ctdir ORIGINAL \
    --ctorigdst "$WORKSPACE_IP" --ctorigdstport "$WORKSPACE_HTTPS_PORT" \
    -j "$chain"
fi
