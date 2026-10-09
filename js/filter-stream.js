(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  const hasTrackProcessor =
    "MediaStreamTrackProcessor" in globalThis &&
    "MediaStreamTrackGenerator" in globalThis &&
    "OffscreenCanvas" in globalThis;

  const even = (value) => Math.floor(value / 2) * 2;

  // Applies a shader to a video track and exposes the result as outputTrack; the input can be swapped live.
  class FilterStream {
    constructor(sourceTrack, shader, stopSource) {
      this.shader = null;
      this.crop = null;
      this.source = null;
      this.reader = null;
      this.readerWaiters = [];
      this.placeholderTimer = null;
      this.width = 640;
      this.height = 480;
      this.onStop = null;
      this.processor = null;
      this.flip = { x: false, y: false };
      this.background = null;
      this.backgroundCrop = null;
      this.warned = false;
      this.stopped = false;
      if (hasTrackProcessor) {
        this.initTrackProcessor();
      } else {
        this.initVideoElement();
      }
      try {
        this.setShader(shader);
      } catch (e) {
        this.stopped = true;
        this.notifyReader();
        throw e;
      }
      this.setSource(sourceTrack, stopSource);
    }

    setShader(shader) {
      if (shader === this.shader) return;
      this.shader = shader;
      try {
        this.renderer.setShader(shader);
      } catch (e) {
        console.error("Virtual webcam: the filter doesn't compile, passing the video through.", e);
        this.renderer.setShader(vw.PASSTHROUGH_SHADER);
      }
    }

    // Replaces the input track; the previous source is stopped.
    setSource(track, stopSource = () => track.stop()) {
      const previous = this.source;
      const source = { track, stop: stopSource, ended: false };
      this.source = source;
      this.crop = null;
      this.clearPlaceholder();
      track.addEventListener("ended", () => this.sourceEnded(source));
      if (hasTrackProcessor) {
        const old = this.reader;
        this.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
        old?.cancel().catch(() => {});
        this.notifyReader();
      } else {
        this.video.srcObject = new MediaStream([track]);
        this.video.play().catch((e) => {
          if (!this.stopped) console.error("Virtual webcam: could not play the video.", e);
        });
      }
      previous?.stop();
    }

    sourceEnded(source) {
      if (source !== this.source || source.ended || this.stopped) return;
      source.ended = true;
      this.showPlaceholder();
    }

    // Keeps the output track alive with a still card until a new source arrives.
    showPlaceholder() {
      if (this.stopped || this.placeholderTimer || !this.writer) return;
      const canvas = new OffscreenCanvas(this.width, this.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#202124";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#e8eaed";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${Math.round(canvas.height / 16)}px system-ui, sans-serif`;
      ctx.fillText("Video source ended", canvas.width / 2, canvas.height / 2);
      const write = () => {
        if (this.stopped) return;
        this.writer.write(new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) })).catch(() => {});
      };
      write();
      this.placeholderTimer = setInterval(write, 500);
    }

    clearPlaceholder() {
      clearInterval(this.placeholderTimer);
      this.placeholderTimer = null;
    }

    setFilter({ language, source }) {
      this.setShader(language === "js" ? vw.PASSTHROUGH_SHADER : source);
    }

    // With a processor, frames go through the sandbox (flip, background, JavaScript filter) before the shader.
    setProcessing(processor) {
      this.processor = processor;
      this.applyFlip();
    }

    setFlip(flip) {
      this.flip = flip;
      this.applyFlip();
    }

    applyFlip() {
      const flip = this.processor ? { x: false, y: false } : this.flip;
      this.renderer.setFlip(flip.x, flip.y);
    }

    // Keeps the latest frame of the background source, for backgrounds that show another source.
    setBackgroundTrack(track, stopTrack = () => track?.stop()) {
      const previous = this.background;
      this.background = null;
      if (previous) {
        previous.reader?.cancel().catch(() => {});
        previous.latest?.close();
        previous.stop();
      }
      if (!track) return;
      const background = { track, stop: stopTrack, latest: null, reader: null };
      this.background = background;
      if (!hasTrackProcessor) return;
      background.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      (async () => {
        while (this.background === background) {
          const { value, done } = await background.reader.read();
          if (done) break;
          if (this.background !== background) {
            value.close();
            break;
          }
          background.latest?.close();
          background.latest = value;
        }
      })().catch(() => {});
    }

    setBackgroundCrop(rect) {
      this.backgroundCrop = rect;
    }

    async backgroundBitmap() {
      const frame = this.background?.latest?.clone();
      if (!frame) return null;
      try {
        if (!this.backgroundCrop) return await createImageBitmap(frame);
        const { x, y, width, height } = frame.visibleRect;
        const crop = this.backgroundCrop;
        return await createImageBitmap(frame, x + crop.x * width, y + crop.y * height, crop.w * width, crop.h * height);
      } catch {
        return null;
      } finally {
        frame.close();
      }
    }

    async processed(input) {
      try {
        const bitmap = await createImageBitmap(input);
        const background = await this.backgroundBitmap();
        return await this.processor.process(bitmap, background);
      } catch (e) {
        if (!this.warned) {
          this.warned = true;
          console.warn("Virtual webcam: couldn't apply the background or JavaScript filter.", e);
        }
        return null;
      }
    }

    // rect is { x, y, w, h } as fractions of the source frame, or null for the whole frame.
    setCrop(rect) {
      this.crop = rect;
    }

    cropped(frame) {
      if (!this.crop) return frame;
      const { x, y, width, height } = frame.visibleRect;
      const left = x + even(this.crop.x * width);
      const top = y + even(this.crop.y * height);
      const visibleRect = {
        x: left,
        y: top,
        width: Math.min(even(this.crop.w * width), x + width - left),
        height: Math.min(even(this.crop.h * height), y + height - top),
      };
      if (visibleRect.width < 16 || visibleRect.height < 16) return frame;
      try {
        return new VideoFrame(frame, { visibleRect });
      } catch {
        return frame;
      }
    }

    notifyReader() {
      const waiters = this.readerWaiters;
      this.readerWaiters = [];
      waiters.forEach((resolve) => resolve());
    }

    // Resolves once the reader differs from `reader`, or the stream stops.
    waitForReader(reader) {
      return new Promise((resolve) => {
        if (this.reader !== reader || this.stopped) {
          resolve();
        } else {
          this.readerWaiters.push(resolve);
        }
      });
    }

    // Reads frames straight from the track, so it keeps running in background tabs.
    initTrackProcessor() {
      const canvas = new OffscreenCanvas(1, 1);
      this.renderer = new vw.ShaderRenderer(canvas);
      const generator = new MediaStreamTrackGenerator({ kind: "video" });
      this.outputTrack = generator;
      this.writer = generator.writable.getWriter();
      this.pump(this.writer, canvas);
    }

    async pump(writer, canvas) {
      try {
        while (!this.stopped) {
          const reader = this.reader;
          if (!reader) {
            await this.waitForReader(null);
            continue;
          }
          const { value: frame, done } = await reader.read();
          if (done) {
            if (reader === this.reader) this.sourceEnded(this.source);
            await this.waitForReader(reader);
            continue;
          }
          if (reader !== this.reader || this.stopped) {
            frame.close();
            continue;
          }
          const input = this.cropped(frame);
          let processed = null;
          try {
            if (this.processor) processed = await this.processed(input);
            if (this.stopped || reader !== this.reader) continue;
            const picture = processed ?? input;
            this.width = processed ? processed.width : input.displayWidth;
            this.height = processed ? processed.height : input.displayHeight;
            this.renderer.setSize(this.width, this.height);
            if (this.renderer.render(picture)) {
              await writer.write(new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) }));
            }
          } finally {
            processed?.close();
            if (input !== frame) input.close();
            frame.close();
          }
        }
      } catch (e) {
        if (!this.stopped) console.error("Virtual webcam: filter stopped.", e);
      } finally {
        this.stopped = true;
        this.reader?.cancel().catch(() => {});
        writer.close().catch(() => {});
      }
    }

    // Fallback for browsers without insertable streams (Firefox); throttled in background tabs.
    initVideoElement() {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      this.video = video;

      const canvas = document.createElement("canvas");
      this.renderer = new vw.ShaderRenderer(canvas);
      this.outputTrack = canvas.captureStream(0).getVideoTracks()[0];

      const schedule = video.requestVideoFrameCallback
        ? () => video.requestVideoFrameCallback(draw)
        : () => requestAnimationFrame(draw);
      const draw = () => {
        if (this.stopped) return;
        if (video.videoWidth) {
          this.renderer.setSize(video.videoWidth, video.videoHeight);
          if (this.renderer.render(video)) this.outputTrack.requestFrame();
        }
        schedule();
      };
      schedule();
    }

    stop() {
      if (this.stopped && !this.source) return;
      this.stopped = true;
      this.clearPlaceholder();
      this.notifyReader();
      this.setBackgroundTrack(null);
      const source = this.source;
      this.source = null;
      source?.stop();
      if (this.video) this.video.srcObject = null;
      this.onStop?.();
    }
  }

  vw.FilterStream = FilterStream;
})();
