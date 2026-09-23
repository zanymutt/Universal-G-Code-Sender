# Camera — Dashboard plugin

This plugin displays an MJPEG stream or a video URL that the browser can decode. It remembers the last URL and stream type through the Dashboard plugin settings API.

Copy this folder to `%USERPROFILE%\\.ugs\\dashboard-plugins\\camera\\` on Windows, `~/.ugs/dashboard-plugins/camera/` on Linux, or the equivalent UGS settings directory on macOS. Reload Dashboard and open **Camera** under Plugins.

## RTSP limitation

Browsers do not natively decode `rtsp://` in an HTML `<video>` element. The plugin detects RTSP and gives a setup hint, but it does not claim to play it directly. Use one of these patterns:

```text
camera RTSP -> go2rtc or MediaMTX -> WebRTC/HLS/MJPEG URL -> Camera plugin
```

The relay must be reachable by the browser running Dashboard and its output must allow the relevant cross-origin requests. WebRTC is usually the best low-latency choice; HLS is simpler but typically adds more delay. If the camera already exposes MJPEG or a browser-compatible stream, no relay is needed.
