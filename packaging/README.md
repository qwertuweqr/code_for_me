# Packaging & permissions

## Desktop launcher

Copy the launcher so CoolControl shows up in your application menu:

```bash
install -Dm644 coolcontrol.desktop ~/.local/share/applications/coolcontrol.desktop
```

## Giving your user permission to control fans

Writing to `/sys/class/hwmon/*/pwm*` needs root. You have two options.

### Option A — run with elevated rights (simplest)

```bash
pkexec coolcontrol
```

### Option B — a udev rule (no password prompt)

`hwmon` PWM attributes are recreated on every boot, so a udev rule is the
robust way to make them writable by a group. The rule below makes every
`pwm*` attribute writable by the `fancontrol` group.

```bash
sudo groupadd -f fancontrol
sudo usermod -aG fancontrol "$USER"
sudo install -Dm644 99-coolcontrol.rules /etc/udev/rules.d/99-coolcontrol.rules
sudo udevadm control --reload && sudo udevadm trigger
# log out and back in for the new group to take effect
```

See [`99-coolcontrol.rules`](99-coolcontrol.rules).
