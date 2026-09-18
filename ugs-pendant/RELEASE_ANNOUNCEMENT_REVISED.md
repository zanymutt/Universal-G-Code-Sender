# Introducing UGS Dashboard — a new control screen for your CNC

I've been working on **UGS Dashboard**, a new web interface for Universal G-Code Sender, and I'm ready to share the first release.

The idea is simple: put the controls you reach for at the machine into a clear, modern workspace that feels at home on a desktop monitor or a touchscreen. Big position readouts, a large jog pad, your toolpath, job controls, and your own macro buttons are all close at hand. You can adjust the interface to suit your screen and keep two tools open side by side when you need them.

Dashboard runs on top of UGS through its pendant web server. Use it on the computer running UGS, or open it in a browser on another device on your local network. UGS still handles the controller connection and G-code streaming; Dashboard gives you another way to work with it. The existing UGS Platform interface and classic web pendant remain available.

This is an independent, open-source UGS fork, with thanks to the Universal G-Code Sender project and its contributors for the foundation.

## A workspace that fits the way you work

**A fresh interface, with touch in mind.** A dark layout, prominent machine coordinates, large jog buttons, and accessible job controls make Dashboard useful both with a mouse and at a machine-mounted touchscreen. On a wide screen, machine position and jogging sit on the left, the working area fills the center, and macros and machine controls sit on the right. Narrow screens switch to tabs for Position, Program, and Machine.

**Make better use of your screen.** Adjust the overall UI scale from 70% to 150%, change the editor and console text sizes independently, or go fullscreen. Resize the console and the split between tools to give the part you're working on more room.

**See the code and the cut together.** Put the 3D toolpath viewer alongside the G-code editor, or pair it with the macro editor or probing tools. Switch between top, left, right, bottom, and 3D views, inspect the program, and make edits without giving up your view of the job. The editor also provides a **Run from here** workflow: select a starting line, confirm it, then press Start when you're ready to begin.

**Give your macros a proper workspace.** Create and edit macros in a dedicated editor with syntax highlighting, descriptions, and shortcuts for inserting UGS macro expressions. Choose button colors and icons so frequently used actions are easier to recognize. Reorder your macros, export an individual macro or the whole list, and import a saved list.

**Browse your job folders from Dashboard.** Open files from your UGS workspace, search across its folders, and sort by name or modification time. Save As lets you browse folders, create a new one, and see existing filenames before saving. Open and Save As remember the last workspace folder you used.

**Bring probing into the same workspace.** The Probe panel includes Z touch-off, X/Y surface probing, and center-finding operations, with diagrams and controls for feed rates, travel, retract, probe diameter, and plate thickness. Available machine operations depend on your controller and setup.

## Add your own tools with plugins

Dashboard also introduces a lightweight **HTML/CSS/JavaScript plugin system**. Plugins open in floating, draggable, resizable windows, so a small custom tool can sit alongside the job you're working on.

Install a plugin by copying its folder into UGS's `dashboard-plugins` directory and reloading Dashboard. There is no UGS rebuild or restart required. The plugin API lets tools read machine status, send commands, work with the loaded G-code, and remember their own settings.

My first example is **Rotate G-code**, shown in the screenshots: load the current program, choose an angle and pivot, and save the result in place or through Dashboard's Save As dialog. It's an example of the kind of focused tool I'd like people to be able to add for their own workflows.

If you know a little HTML and JavaScript, the [plugin developer guide](PLUGIN_API_REVISED.md) includes a complete starter you can copy and build on.

## Launch straight into Dashboard

There's also a new option in the original **UGS Platform GUI** to open Dashboard automatically on the computer running UGS when Platform starts.

Under **Options → UGS → Sender Options**, enable **Auto start pendant on startup** and **Open dashboard in browser on startup**. You can also select **Open without browser UI (Chrome/Edge app mode)** for a separate window without browser tabs or an address bar. If a compatible browser isn't found, it falls back to the default browser.

For a dedicated machine computer or touchscreen, that means one less step between launching UGS and getting to your control screen.

## Try it and tell me what you think

**Download:** [add the specific Dashboard release link before publishing]

With the pendant server running, Dashboard is available at `http://localhost:8080/dashboard` on the UGS computer, or `http://<UGS-computer-address>:8080/dashboard` from another device on your local network. Use your configured pendant port if you've changed it from 8080.

This is a first release, and I'd especially like feedback from people using different screen sizes, touchscreens, and controller setups. What's comfortable to use at your machine? What takes too many taps? What small tool would you build as a plugin?

Thanks to everyone who gives it a try—and to the [UGS community](https://github.com/winder/Universal-G-Code-Sender) for making projects like this possible.
