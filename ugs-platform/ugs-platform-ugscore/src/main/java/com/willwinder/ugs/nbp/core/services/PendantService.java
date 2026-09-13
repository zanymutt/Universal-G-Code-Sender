/*
    Copyright 2019 Will Winder

    This file is part of Universal Gcode Sender (UGS).

    UGS is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    UGS is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with UGS.  If not, see <http://www.gnu.org/licenses/>.
 */
package com.willwinder.ugs.nbp.core.services;

import com.willwinder.universalgcodesender.listeners.MessageType;
import com.willwinder.universalgcodesender.model.BackendAPI;
import com.willwinder.universalgcodesender.pendantui.PendantUI;
import com.willwinder.universalgcodesender.pendantui.PendantURLBean;
import com.willwinder.universalgcodesender.services.LookupService;
import com.willwinder.universalgcodesender.utils.Settings;
import org.openide.util.lookup.ServiceProvider;

import java.awt.Desktop;
import java.net.URI;
import java.util.Collection;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * A service that will start the pendant server if auto start is enabled
 */
@ServiceProvider(service = PendantService.class)
public class PendantService {

    private static final Logger LOGGER = Logger.getLogger(PendantService.class.getName());
    private final BackendAPI backend;
    private PendantUI pendantUI;

    public PendantService() {
        backend = LookupService.lookup(BackendAPI.class);
        autoStartPendant();
        LOGGER.info("Starting pendant service");
    }

    /**
     * Checks the auto start setting and starts the pendant.
     */
    private void autoStartPendant() {
        Settings settings = backend.getSettings();
        if (settings.isAutoStartPendant()) {
            startPendant();
            if (settings.isAutoOpenDashboardInBrowser()) {
                openDashboardInBrowser();
            }
        }
    }

    /**
     * Opens the touchscreen dashboard in the system's default browser, pointed at this same
     * machine (not one of the LAN URLs from {@link PendantUI#getUrlList()}, which deliberately
     * excludes the loopback address since those are meant for other devices on the network) -
     * lets a kiosk/touchscreen setup launch straight into the dashboard instead of requiring a
     * second, manual "open the browser and type the address" step every time.
     */
    private void openDashboardInBrowser() {
        if (!Desktop.isDesktopSupported() || !Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
            LOGGER.warning("Can't auto-open the dashboard in a browser - not supported on this platform");
            return;
        }

        try {
            String url = "http://localhost:" + getPort() + PendantUI.DASHBOARD_CONTEXT_PATH;
            Desktop.getDesktop().browse(new URI(url));
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Could not auto-open the dashboard in a browser", e);
        }
    }

    /**
     * Starts the pendant if not started. Returns a list of URL:s of the started pendant server.
     *
     * @return a list of URL:s to the pendant
     */
    public Collection<PendantURLBean> startPendant() {
        Collection<PendantURLBean> results;
        if (pendantUI == null) {
            pendantUI = new PendantUI(backend);
            results = pendantUI.start();

            for (PendantURLBean result : results) {
                backend.dispatchMessage(MessageType.INFO, "Pendant URL: " + result.getUrlString());
            }
        } else {
            results = pendantUI.getUrlList();
        }
        return results;
    }

    public int getPort() {
        return backend.getSettings().getPendantPort();
    }
}
