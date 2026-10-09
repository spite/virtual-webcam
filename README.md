# Virtual Webcam

A browser extension that adds a virtual camera, "Virtual Chrome Webcam", to every site. Video-call apps see it as an ordinary webcam. You choose what it shows: your real camera, a tab or window, a video file, or a video playing in another tab. You can replace your background and apply live filters, written as GLSL shaders or in JavaScript with MediaPipe.

![Virtual webcam](shader-cam.png)

## Features

- **A virtual camera** that apps like Meet and Zoom list next to your real ones. A toggle can also make it the default camera.
- **Sources:**
  - your camera;
  - a tab, window or screen;
  - the video playing in a tab;
  - a video file;
  - a video shared from any tab with a right-click.
- **Backgrounds:** blur, an image, or you cut out and placed over any of the other sources.
- **Filters:** 15 built in, plus an editor for writing your own in GLSL (Shadertoy-style) or JavaScript. MediaPipe face tracking and segmentation are bundled.
- **Mirroring:** flip the picture horizontally or vertically.
- **Live changes:** everything applies live, even mid-call, with no reload and no need to restart the camera in the app.

## Install

Chrome or Edge (a recent version):

1. Download or clone this repository.
2. Go to `chrome://extensions` (`edge://extensions` in Edge) and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Reload any tabs that were already open.

Firefox 128+ can load it as a temporary add-on from `about:debugging#/runtime/this-firefox`, but support is partial and untested. See [Limitations](#limitations).

## Using it

In a video-call app, choose **Virtual Chrome Webcam** as the camera. To get it on sites that don't let you pick a camera, open the extension's popup and turn on **Use the virtual camera by default**. Sites that ask for a specific camera still get that camera.

Everything else is set in the popup, and applies straight away to any call in progress.

### Source

What the virtual camera shows.

| Source | How it works |
|---|---|
| Camera | Your real webcam. |
| Tab, window or screen | Chrome's picker asks which one to share. |
| Video in a tab | Pick a tab in Chrome's picker. The extension finds the main video playing in it and crops to it, following it as the page scrolls or resizes. |
| Video file | Choose or drop a video on the extension's video page (popup → **Choose…**). It loops, without sound. |
| Shared video | Right-click a video in any tab, choose **Use this video as webcam**, then **Share**. Only the video element is captured, using Element Capture, so player controls and overlays don't appear. It's sent to the call over a local WebRTC connection and stays shared until you stop it. |

Chrome only shows its screen-sharing picker straight after a click in the page. If the camera starts without one, or you switch to a picker source from the popup, a small **Choose…** prompt appears in the call tab first.

If a source ends (for example, you stop sharing), the camera keeps running with a "Video source ended" card, and the page offers to switch back to the camera.

### Background

- **Keep:** your real background.
- **Blur**.
- **Image:** choose one from the popup.
- **Over a tab, window or screen / the video in a tab / the video file / the shared video:** you're cut out of your camera picture and placed over that source. This is useful for presenting.

### Filter

Pick a filter in the popup, or open **Edit or create filters…** to write your own. Built-in filters can be edited in place: your version is saved separately and can be reset to the original.

The built-in filters are:
- **Shaders:** None, Black & white, Sepia, Pixelate, Posterize, CRT monitor, Game Boy, Distorted TV, Pencil sketch, Comic halftone, Money, Thermal camera, Kaleidoscope, RGB glitch.
- **JavaScript:** Eye bar, a black bar over the eyes that follows each face.

The filter applies after the background, and both apply to any source. **Flip horizontally** and **Flip vertically** flip the picture before the filter, so filters that draw shapes or text still come out the right way round.

## Writing filters

The editor compiles as you type, marks errors on the right line, and previews against a test pattern, your camera or the video file. Filters can be imported and exported as files.

### GLSL shaders

Filters are Shadertoy-style GLSL ES 3.0 shaders, so most Shadertoy image filters can be pasted in as-is. Write a `mainImage` function; the camera is `iChannel0`.

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 color = texture(iChannel0, uv).rgb;
  fragColor = vec4(vec3(dot(color, vec3(0.299, 0.587, 0.114))), 1.0);
}
```

Available inputs:
- **Size and time:** `iResolution`, `iTime`, `iTimeDelta`, `iFrameRate`, `iFrame`, `iDate`.
- **Textures:** `iChannel0` is the camera; `iChannel1`–`3` are black. `iChannelResolution` gives their sizes.
- **Always zero:** `iMouse`.
- **Older shaders:** `texture2D()` works as an alias of `texture()`.

### JavaScript

A JavaScript filter defines `draw(frame, ctx, info)`, which runs for every frame, and optionally `async setup({ mediapipe })`, which runs once.
- `frame` is an `ImageBitmap`, and `ctx` is a 2D canvas context the size of the frame. Whatever you draw is the output.
- `info` has `time`, `width`, `height` and `frame` (a counter).

```js
let landmarker;

async function setup({ mediapipe }) {
  landmarker = await mediapipe.faceLandmarker({ numFaces: 1 });
}

function draw(frame, ctx, { time, width, height }) {
  ctx.drawImage(frame, 0, 0, width, height);
  for (const points of landmarker.detectForVideo(frame, time).faceLandmarks) {
    const nose = points[1];
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(nose.x * width, nose.y * height, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

MediaPipe Tasks Vision is bundled:
- `mediapipe.faceLandmarker(options)` returns a [FaceLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js).
- `mediapipe.selfieSegmenter(options)` returns an ImageSegmenter for separating people from the background.
- `mediapipe.vision`, `mediapipe.fileset` and `mediapipe.models` give the whole API and the bundled models, for building other tasks.

Filters have no network access, so they can only use what's bundled.

### Adding a built-in filter

Add a file to `js/filters/` (see the existing ones), then list it in `manifest.json`, `popup.html`, `editor.html` and `cam.html`.

## How it works

- **The camera patch.** A content script runs in each page's own JavaScript world at `document_start`. It wraps `navigator.mediaDevices.enumerateDevices()` and `getUserMedia()`. When an app asks for the virtual camera, the extension opens the chosen source and runs it through a WebGL filter pipeline. It hands the app a generated video track (`MediaStreamTrackProcessor` → shader → `MediaStreamTrackGenerator`).
- **Live switching.** All of a page's virtual camera streams share one source, so switching updates them all without the app's track changing.
- **Settings.** They live in extension storage. A second content script, in the extension's isolated world, relays them to the page and brokers requests that need the extension, such as opening the video file or connecting to a shared video.
- **The processor.** Background effects and JavaScript filters run in a sandboxed extension page that's embedded in the call page as a hidden frame. Frames travel in and out as `ImageBitmap`s. Because the frame belongs to the extension, the page's own security policy (Meet's, for example) doesn't affect it. It's only added while it's needed.
- **Shared videos.** The tab with the video captures itself, restricted to the video element (Element Capture), and sends the result to the call tab over a local WebRTC connection. The background script carries the connection setup between the two tabs.

`cam.html` shows the filter pipeline used as a plain library, without the extension.

## Privacy and security

- **Nothing leaves your machine.** The extension never sends your video anywhere. Shared videos go between tabs over a local WebRTC connection.
- **Your stored video and image stay protected.** A site can only receive the stored video file, the background image or a shared video if it already has camera permission, as it would need for a real camera.
- **Filters are sandboxed.** JavaScript filters and background effects run in a sandboxed page with no network access: its security policy blocks the usual network APIs, and WebRTC is removed. That stops ordinary network calls, not a determined attacker, so only import filters you trust.
- **The usual warnings still apply.** The webcam light still turns on when the real camera is in use. Chrome shows its usual sharing indicators for tab, window and screen capture.

## Limitations

- **Sites with strict media policies.** Sites whose security policy blocks `blob:` media can't play the video file; the camera is used instead.
- **DRM-protected video.** Netflix and similar show as black in any capture.
- **Right-clicking on YouTube.** Right-click twice to get Chrome's menu instead of YouTube's. Videos inside embedded frames can't be shared yet.
- **Overlays in "Video in a tab".** That source crops a capture of the whole tab, so the player's controls show if you hover over the video. **Shared video** avoids this.
- **Sites that check devices closely.** Some sites use shims or device checks that don't expect a virtual camera; the [WebRTC device sample](https://webrtc.github.io/samples/src/content/devices/input-output/) is one.
- **Firefox:**
  - sandboxed extension pages aren't supported, so background effects and JavaScript filters don't run;
  - Element Capture and capture handles aren't available, so "Shared video" and the cropping in "Video in a tab" don't work;
  - filters freeze while the tab is in the background;
  - after an extension update, open tabs need a refresh.

Tested with Google Meet and YouTube in Chrome.

## License

This project is licensed under the [CC-BY-4.0 License](https://creativecommons.org/licenses/by/4.0/).

Third-party parts:
- The **Distorted TV** and **Money** filters are from Shadertoy ([ldXGW4](https://shadertoy.com/view/ldXGW4) by ehj1, [XlsXDN](https://shadertoy.com/view/XlsXDN) by @giacomopc). They're under Shadertoy's default licence, [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), which is stricter than this project's.
- **MediaPipe** and its models (`vendor/mediapipe/`) are under the Apache License 2.0; see `vendor/mediapipe/NOTICE.md`.
