# UGS Dashboard

**A clear, touch-friendly web control screen for [Universal G-Code Sender](https://github.com/winder/Universal-G-Code-Sender).**

[![Nightly build](https://img.shields.io/github/actions/workflow/status/zanymutt/Universal-G-Code-Sender/nightly.yaml?branch=master&label=nightly%20build)](https://github.com/zanymutt/Universal-G-Code-Sender/actions/workflows/nightly.yaml)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg)](https://github.com/zanymutt/Universal-G-Code-Sender/blob/master/COPYING)
[![Live demo](https://img.shields.io/badge/live-demo-brightgreen.svg)](https://zanymutt.github.io/Universal-G-Code-Sender/)
[![Documentation](https://img.shields.io/badge/docs-website-informational.svg)](https://zanymutt.github.io/ugs-dashboard/)

> **This is an unofficial fork.** It is an independent project built on Universal G-Code Sender by Will Winder and its contributors, and it is not affiliated with or endorsed by the upstream project.
> **Looking for the original?** Go to [**winder/Universal-G-Code-Sender**](https://github.com/winder/Universal-G-Code-Sender), its [releases](https://github.com/winder/Universal-G-Code-Sender/releases) and its website, [universalgcodesender.com](https://universalgcodesender.com/).

<p align="center">
  <a href="https://zanymutt.github.io/ugs-dashboard/">
    <img src="https://zanymutt.github.io/ugs-dashboard/img/dashboard-overview.webp" alt="The UGS Dashboard: position readouts and a jog pad on the left, a 3D toolpath and console in the middle, macros, spindle and overrides on the right." width="100%">
  </a>
</p>

**[Try the live demo](https://zanymutt.github.io/Universal-G-Code-Sender/)** (a simulated machine in your browser, nothing connects to hardware) &nbsp;·&nbsp; **[Read the documentation](https://zanymutt.github.io/ugs-dashboard/)** &nbsp;·&nbsp; **[Download](#download)**

## What this fork adds

UGS handles the controller connection and G-code streaming. The Dashboard is a new interface on top of it, served by UGS's built-in web server, so you can use it on the UGS computer or from any tablet or phone on your network. The regular UGS window and the classic web pendant keep working.

- **Made for touch and for the desktop.** Big position readouts, a large jog pad and job controls that are easy to hit, in a dark layout.
- **Panes that fit your screen.** Split the workspace and choose what each pane shows: the 3D toolpath, the G-code editor, macros, probing or the console.
- **Saved layouts and backup.** Save your pane arrangements and dashboard layouts, export them to a file, and restore them or move them to another device.
- **See the code and the cut together.** Play a job back with **Simulate**, color the path by cutting order, and use **Run from here** to start from a chosen line.
- **G-code review.** Check the editor's contents for parser errors, unknown G/M-codes and more than one motion code on a line, and jump to each finding. It's advisory only and never sends anything to the machine.
- **Macros.** Uses UGS's own macros and adds a button color, an icon and an order to each.
- **Probing.** Z touch-off, X/Y surface probing and center finding, with guided controls.
- **Plugins.** A lightweight HTML, CSS and JavaScript plugin system opens small tools in floating windows, with no rebuild or restart.
- **On any screen.** Adapts to a laptop, a tablet or a phone.

Everything else is upstream UGS. This fork merges the upstream project into its `master` branch every week.

## Download

> [!WARNING]
> **Experimental, and only Windows has been tested.** The `nightly` release is rebuilt automatically whenever `master` changes, so it always holds the latest work and is not a stable release. The Linux and macOS builds are produced automatically but have **not been tested at all**. This software can jog, run and stop a real CNC machine, so try it away from a machine that can cause harm and keep an emergency stop within reach.

**[Get the latest build from the nightly release](https://github.com/zanymutt/Universal-G-Code-Sender/releases/tag/nightly)**, and pick the file for your system from the **Assets** list. Java is included.

| System | File | Status |
| --- | --- | --- |
| Windows | `win64-ugs-platform-app-….zip` | Tested |
| Linux | `linux-x64-ugs-platform-app-….tar.gz` (or `linux-aarch64-…` for ARM) | Not tested |
| macOS | `macosx-aarch64-ugs-platform-app-….dmg` for Apple silicon, or `macosx-x64-…` for Intel | Not tested |

Unzip it (Windows), extract it (Linux) or open the `.dmg` (macOS), then start the program. On Windows that's `ugsplatform-win\bin\ugsplatform64.exe`, and on Linux it's `ugsplatform-linux-x64/bin/ugsplatform`. See the [Download page](https://zanymutt.github.io/ugs-dashboard/download) for step-by-step instructions.

Want the stable, official Universal G-Code Sender instead? Use the [upstream releases](https://github.com/winder/Universal-G-Code-Sender/releases).

## Quick start

1. Start UGS.
2. Go to **Options → UGS → Sender Options** and turn on **Auto start pendant on startup**. You can also turn on **Open dashboard in browser on startup**.
3. Open **`http://localhost:8080/dashboard`** on the UGS computer, or `http://<UGS-computer-address>:8080/dashboard` from another device on your network. The default port is 8080.

More in the [Getting started guide](https://zanymutt.github.io/ugs-dashboard/guide/getting-started).

## Documentation

- [Getting started](https://zanymutt.github.io/ugs-dashboard/guide/getting-started)
- [Your workspace](https://zanymutt.github.io/ugs-dashboard/guide/workspace) and [saved layouts & backup](https://zanymutt.github.io/ugs-dashboard/guide/layouts)
- [Editing, macros & probing](https://zanymutt.github.io/ugs-dashboard/guide/features)
- [Using plugins](https://zanymutt.github.io/ugs-dashboard/plugins/) and [building a plugin](https://zanymutt.github.io/ugs-dashboard/plugins/developer-guide)

## Feedback

Please report problems and share ideas in this fork's [issues](https://github.com/zanymutt/Universal-G-Code-Sender/issues). **Please don't report Dashboard problems to the upstream project.** They didn't write it and can't help with it.

## The original project

Universal G-Code Sender is a free, self-contained, cross-platform G-code sender for GRBL, FluidNC, TinyG, g2core and Smoothieware controllers. It is the work of [Will Winder](https://github.com/winder) and its many contributors.

- Repository: [winder/Universal-G-Code-Sender](https://github.com/winder/Universal-G-Code-Sender)
- Website: [universalgcodesender.com](https://universalgcodesender.com/)
- Documentation: [winder.github.io/ugs_website](https://winder.github.io/ugs_website/)
- Releases: [github.com/winder/Universal-G-Code-Sender/releases](https://github.com/winder/Universal-G-Code-Sender/releases)
- The upstream README, which this repository still contains: [README.md](https://github.com/zanymutt/Universal-G-Code-Sender/blob/master/README.md)

## License

Released under the [GNU General Public License v3](https://github.com/zanymutt/Universal-G-Code-Sender/blob/master/COPYING), the same license as upstream. It is provided as is, with no warranty.
