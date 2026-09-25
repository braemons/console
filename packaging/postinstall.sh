#!/bin/sh
set -e

if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
fi

# Enabled on the first install only, so an upgrade leaves a console someone
# disabled on purpose disabled. $2 is the version being upgraded from.
if [ "$1" = configure ] && [ -z "${2:-}" ]; then
    systemctl enable braemons-console.service >/dev/null 2>&1 || true
fi

# Restart, not start: an upgrade has to pick up the new shell. A disabled unit
# is left alone.
if [ -d /run/systemd/system ] && systemctl -q is-enabled braemons-console.service 2>/dev/null; then
    systemctl restart braemons-console.service || true
fi
