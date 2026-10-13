# Gamepad API test page

One self-contained page (`index.html`, no dependencies) that shows what a browser can see of a joystick or
gamepad: whether the Gamepad API is available on the address you opened it from, which controllers are visible, and
live button and axis values.

## Why

The dashboard reads controllers through the browser's Gamepad API, in the browser on the device the controller is
plugged into or paired with. Whether that works depends on the browser, the address (a plain `http://<LAN ip>` page
is not a "secure context") and how the operating system presents the controller. This page answers that in
seconds, and it is how a controller's real layout was found (a Bluetooth Xbox pad reports no standard mapping, its
D-pad is a hat on axis 9 with a huge neutral value, and its triggers rest at -1).

## Use it

From the repository root:

```bash
python -m http.server 8099 --bind 0.0.0.0 --directory ugs-pendant/tools/gamepad-test
# or: npx --yes http-server ugs-pendant/tools/gamepad-test -p 8099
```

On the device the controller is attached to, open `http://<this PC's address>:8099/`, click the page once and press a
button on the controller. The verdict at the top says whether it works at that address. Use the same kind of
address you use for the dashboard (`localhost` or a LAN IP).

## Things it taught us

- Chrome exposes the Gamepad API on a plain-HTTP LAN origin; no HTTPS or browser flag was needed.
- Chrome keeps reading a controller while the window is visible but not focused, so the dashboard only acts on it
  while it is focused unless the person opts out.
- A reconnect can switch the same pad between a raw-HID layout (15 buttons, 10 axes, triggers as axes) and the
  standard mapping (17 buttons, 4 axes, triggers as analog buttons 6 and 7), which renumbers every button.
