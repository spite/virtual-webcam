// Opens the non-camera video sources. Each returns { track, stop(), watchCrop?(listener) }.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});
  const getDisplayMediaFn = MediaDevices.prototype.getDisplayMedia;

  // Thrown when a source can't be used here, so the caller falls back to the real camera.
  class SourceUnavailable extends Error {
    constructor(message) {
      super(message);
      this.name = "SourceUnavailable";
    }
  }

  // Chrome only opens its picker right after a click, so without one, ask for a click in the page first.
  async function ensureUserActivation(kind, purpose) {
    if (navigator.userActivation?.isActive || !vw.extension) return;
    let chosen = false;
    try {
      chosen = await vw.extension.request("share-prompt", { kind, purpose }, 120000);
    } catch {}
    if (!chosen) throw new DOMException("Nothing was chosen to share.", "NotAllowedError");
  }

  async function captureDisplay(surface, purpose) {
    await ensureUserActivation(surface === "browser" ? "tab" : "any", purpose);
    // Keeps the call tab in front instead of jumping to whatever was picked.
    let controller;
    try {
      controller = new CaptureController();
      controller.setFocusBehavior("no-focus-change");
    } catch {
      controller = undefined;
    }
    try {
      const stream = await getDisplayMediaFn.call(navigator.mediaDevices, {
        controller,
        video: {
          displaySurface: surface,
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { max: 30 },
        },
        audio: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      });
      return stream.getVideoTracks()[0];
    } catch (e) {
      if (e.name === "InvalidStateError") {
        throw new SourceUnavailable("Chrome only shows the screen picker right after a click; this site opened the camera without one.");
      }
      throw e;
    }
  }

  async function display({ purpose }) {
    const track = await captureDisplay(undefined, purpose);
    return { track, stop: () => track.stop() };
  }

  async function waitForOurCaptureHandle(track) {
    const read = () => {
      const handle = track.getCaptureHandle?.()?.handle;
      return handle?.startsWith("virtual-webcam:") ? handle : null;
    };
    return new Promise((resolve) => {
      const check = () => {
        const handle = read();
        if (handle) finish(handle);
      };
      const timer = setTimeout(() => finish(null), 3000);
      const finish = (handle) => {
        clearTimeout(timer);
        track.removeEventListener("capturehandlechange", check);
        resolve(handle);
      };
      track.addEventListener("capturehandlechange", check);
      check();
    });
  }

  async function tabVideo({ purpose }) {
    const track = await captureDisplay("browser", purpose);
    let handle = null;
    if (track.getCaptureHandle && track.getSettings().displaySurface === "browser") {
      await vw.extension.request("capture-handles").catch(() => {});
      handle = await waitForOurCaptureHandle(track);
    }
    if (!handle) {
      console.info("Virtual webcam: couldn't find the video in the shared surface, so the whole of it is used.");
      return { track, stop: () => track.stop() };
    }

    const watchId = crypto.randomUUID();
    let unsubscribe = null;
    return {
      track,
      watchCrop(listener) {
        unsubscribe = vw.extension.on("rect", (message) => {
          if (message.watchId === watchId) listener(message.rect);
        });
        vw.extension.request("rect-watch", { watchId, handle }).catch(() => {});
      },
      stop() {
        track.stop();
        unsubscribe?.();
        vw.extension.request("rect-unwatch", { watchId }).catch(() => {});
      },
    };
  }

  // The page needs camera permission to use the virtual camera, as it would for a real one.
  async function ensureCameraPermission(getUserMedia) {
    let state = "prompt";
    try {
      state = (await navigator.permissions.query({ name: "camera" })).state;
    } catch {}
    if (state === "granted") return;
    const stream = await getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
  }

  function receiveFile(url, token) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = `${url}#${token}`;
      const timer = setTimeout(() => {
        finish(new SourceUnavailable("The video file couldn't be loaded into this page."));
      }, 10000);
      const onMessage = (e) => {
        if (e.source !== frame.contentWindow || e.data?.type !== "virtual-webcam-file" || e.data.token !== token) return;
        finish(e.data.error ? new SourceUnavailable(e.data.error) : null, e.data.blob);
      };
      const finish = (error, blob) => {
        clearTimeout(timer);
        removeEventListener("message", onMessage);
        frame.remove();
        if (error) {
          reject(error);
        } else {
          resolve(blob);
        }
      };
      addEventListener("message", onMessage);
      (document.body ?? document.documentElement).append(frame);
    });
  }

  async function receiveStoredFile(key) {
    const { token, url } = await vw.extension.request("file-token", { key });
    return receiveFile(url, token);
  }

  async function file({ getUserMedia }) {
    await ensureCameraPermission(getUserMedia);
    const blob = await receiveStoredFile("video");

    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(blob);
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = objectUrl;
    const release = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    };
    try {
      // Chrome won't start a muted video in a hidden tab, so wait until the page is shown.
      if (document.hidden) {
        await new Promise((resolve) => document.addEventListener("visibilitychange", resolve, { once: true }));
      }
      await video.play();
    } catch (e) {
      release();
      throw new SourceUnavailable(`The video file couldn't be played here (${e.name}).`);
    }
    const track = (video.captureStream ?? video.mozCaptureStream).call(video).getVideoTracks()[0];
    if (!track) {
      release();
      throw new SourceUnavailable("The video file has no picture.");
    }
    return {
      track,
      stop() {
        track.stop();
        release();
      },
    };
  }

  function iceComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (pc.iceGatheringState !== "complete") return;
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      };
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, 2000);
    });
  }

  async function relay({ getUserMedia }) {
    await ensureCameraPermission(getUserMedia);
    const relayId = crypto.randomUUID();
    const pc = new RTCPeerConnection();
    pc.addTransceiver("video", { direction: "recvonly" });
    // Closes as soon as the sharing tab stops, much sooner than the connection state notices.
    const control = pc.createDataChannel("control");
    const trackReady = new Promise((resolve) => {
      pc.addEventListener("track", (e) => resolve(e.track), { once: true });
    });
    await pc.setLocalDescription(await pc.createOffer());
    await iceComplete(pc);

    let answer;
    try {
      answer = await vw.extension.request("relay-connect", { relayId, offer: pc.localDescription.toJSON() }, 15000);
      await pc.setRemoteDescription(answer);
    } catch (e) {
      pc.close();
      throw new SourceUnavailable(e.message);
    }
    const track = await trackReady;
    let stopped = false;
    let endedListener = null;
    const stop = () => {
      stopped = true;
      track.stop();
      pc.close();
      vw.extension.request("relay-close", { relayId }).catch(() => {});
    };
    const ended = () => {
      if (!stopped) endedListener?.();
    };
    control.addEventListener("close", ended);
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed"].includes(pc.connectionState)) ended();
    });
    return {
      track,
      stop,
      onEnded(listener) {
        endedListener = listener;
      },
    };
  }

  // A still image as a video track, for scenes that show only the background image.
  async function image({ getUserMedia }) {
    await ensureCameraPermission(getUserMedia);
    const bitmap = await createImageBitmap(await receiveStoredFile("background-image"));
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round((bitmap.width * scale) / 2) * 2);
    canvas.height = Math.max(2, Math.round((bitmap.height * scale) / 2) * 2);
    const ctx = canvas.getContext("2d");
    const draw = () => ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    draw();
    const track = canvas.captureStream(5).getVideoTracks()[0];
    // A canvas only produces frames when it's drawn to.
    const timer = setInterval(draw, 200);
    return {
      track,
      stop() {
        clearInterval(timer);
        track.stop();
        bitmap.close();
      },
    };
  }

  const openers = { display, "tab-video": tabVideo, file, relay, image };

  vw.SourceUnavailable = SourceUnavailable;
  vw.receiveStoredFile = receiveStoredFile;
  vw.openSource = (kind, helpers) => {
    const open = openers[kind];
    if (!open) throw new SourceUnavailable(`Unknown source "${kind}".`);
    if (kind !== "display" && !vw.extension) throw new SourceUnavailable("This source needs the extension.");
    return open(helpers);
  };
})();
