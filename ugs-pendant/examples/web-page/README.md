# Web Page — Dashboard plugin

This plugin displays an internal or external `http://`/`https://` page in a Dashboard window. Enter a full URL or a path such as `/some/dashboard/page`; the last URL is remembered through the Dashboard plugin settings API.

Copy this folder to `%USERPROFILE%\\.ugs\\dashboard-plugins\\web-page\\` on Windows, `~/.ugs/dashboard-plugins/web-page/` on Linux, or the equivalent UGS settings directory on macOS. Reload Dashboard and open **Web Page** under Plugins.

The destination must permit iframe embedding. A site that sends `X-Frame-Options` or a restrictive `Content-Security-Policy: frame-ancestors` header may show a blank or refused frame; that is enforced by the browser. The plugin only allows HTTP and HTTPS URLs.
