#!/bin/sh
set -eu
ssh-keygen -A
if [ -f /fixture-key/key.pub ]; then
  cp /fixture-key/key.pub /home/lab/.ssh/authorized_keys
  chmod 600 /home/lab/.ssh/authorized_keys
  chown lab:lab /home/lab/.ssh/authorized_keys
fi
exec /usr/sbin/sshd -D -e
