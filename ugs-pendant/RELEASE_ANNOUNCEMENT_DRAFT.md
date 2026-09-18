# [Release] UGS Dashboard: touchscreen pendant UI update - plugins, better file browsing

I maintain an independent fork of [Universal G-Code Sender](https://github.com/winder/Universal-G-Code-Sender) focused on a touchscreen-friendly **Dashboard** UI - a second web-based pendant (alongside UGS's existing classic one) built for a machine-mounted tablet/monitor rather than a phone: big DRO, jog pad, live 3D toolpath viewer, gcode editor, macros, and console, all in one always-visible layout.

This isn't an official UGS release - it's my own fork (unofficial, independent, GPL like the original) - but it's fully open and built on the same codebase.

**What's new in this update:**

**A plugin system.** Drop a folder into a `dashboard-plugins` directory and it shows up in the dashboard as an installable tool - no rebuild, no restart. Plugins run sandboxed (they can't touch the rest of the page or your machine directly) and talk to the dashboard through a small, deliberate API: read machine status, send commands, read/modify the loaded gcode, save a new file through the same dialog a person would use. I wrote up the full API with examples if you want to build one.

First plugin out of the gate: a **rotate-gcode** tool - rotate a loaded file by any angle around the origin or its toolpath center, with FluidNC-style conditionals/variables/expressions in the file left completely untouched (so probing macros embedded in a job survive a rotate intact).

**Save As now actually browses folders.** Previously it could only ever save to the root of your workspace. Now it has the same folder tree as the Open dialog, a "New folder" button, shows the files already in whatever folder you're in so you can click one to overwrite it (with a confirmation first), and remembers the last folder you used - shared with the Open dialog, so they stay in sync.

**Smaller stuff:** the Open/Save dialogs now scroll to show you where you actually are when reopened deep in a folder structure, instead of leaving you scrolled to the top with no clue.

**Get it:** [release link here] - grab the build for your OS. Windows users want the `win64-*.zip` (fully self-contained, no Java install needed - unzip and run).

**Feedback/bugs/plugin ideas welcome** - this is a side project I'm actively building on, not a "done" release.
