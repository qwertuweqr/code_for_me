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

## Continuous integration & releases

Ready-to-use GitHub Actions workflows live in
[`github-workflows/`](github-workflows/):

- `ci.yml` — builds the app and runs the tests on every push / pull request.
- `release.yml` — builds a self-contained AppImage and publishes it as a
  GitHub Release when a version tag (e.g. `v1.0.0`) is pushed.

To enable them, copy them into `.github/workflows/` (this requires a token
with the `workflow` scope, e.g. a normal push from the GitHub web UI or your
own machine):

```bash
mkdir -p .github/workflows
cp packaging/github-workflows/*.yml .github/workflows/
git add .github/workflows && git commit -m "ci: enable workflows" && git push
git tag v1.0.0 && git push origin v1.0.0   # triggers the AppImage release
```

