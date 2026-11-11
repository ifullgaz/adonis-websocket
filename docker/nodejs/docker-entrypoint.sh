#!/bin/sh
set -e

exec /sbin/tini -- tail -f /dev/null
