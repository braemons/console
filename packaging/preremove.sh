#!/bin/sh
set -e

if [ -d /run/systemd/system ]; then
    systemctl stop braemons-console.service || true
fi
# Only when it goes away: an upgrade keeps whatever was enabled.
if [ "$1" = remove ]; then
    systemctl disable braemons-console.service >/dev/null 2>&1 || true
fi
