// One shared video source per page: every virtual camera stream gets its own clone of it, and they switch together.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  class SourceManager {
    constructor(getUserMedia) {
      this.getUserMedia = getUserMedia;
      this.active = null;
      this.users = new Set();
      this.queue = Promise.resolve();
      this.wantedKind = null;
      this.cameraVideo = {};
      this.background = null;
      this.wantedBackground = "keep";
    }

    // Runs tasks one at a time, so overlapping requests never open sources in parallel.
    run(task) {
      const next = this.queue.then(task, task);
      this.queue = next.catch(() => {});
      return next;
    }

    async open(kind, purpose = "webcam") {
      if (kind === "camera" || !vw.openSource) {
        const stream = await this.getUserMedia({ video: this.cameraVideo });
        const [track] = stream.getVideoTracks();
        return { kind: "camera", track, stop: () => track.stop() };
      }
      return { kind, ...(await vw.openSource(kind, { getUserMedia: this.getUserMedia, purpose })) };
    }

    lease(source) {
      const track = source.track.clone();
      return { track, stop: () => track.stop() };
    }

    activate(source) {
      const previous = this.active;
      this.active = source;
      source.crop = null;
      source.track.addEventListener("ended", () => this.ended(source));
      source.onEnded?.(() => this.ended(source));
      source.watchCrop?.((rect) => {
        source.crop = rect;
        if (this.active === source) this.users.forEach((filter) => filter.setCrop(rect));
      });
      for (const filter of this.users) {
        const { track, stop } = this.lease(source);
        filter.setSource(track, stop);
      }
      previous?.stop();
    }

    // Opens (or reuses) the source and builds a filter on a clone of it.
    start(kind, cameraVideo, createFilter, background) {
      this.wantedBackground = background;
      return this.run(async () => {
        if (!this.active || this.active.ended) {
          this.cameraVideo = cameraVideo;
          let source;
          try {
            source = await this.open(kind);
          } catch (e) {
            if (!(e instanceof vw.SourceUnavailable)) throw e;
            console.warn(`Virtual webcam: ${e.message} Using the camera instead.`);
            source = await this.open("camera");
          }
          this.activate(source);
        }
        const source = this.active;
        const lease = this.lease(source);
        let filter;
        try {
          filter = createFilter(lease.track, lease.stop);
        } catch (e) {
          console.error("Virtual webcam: filter failed, using the source unfiltered.", e);
          return { track: lease.track };
        }
        filter.setCrop(source.crop);
        this.users.add(filter);
        filter.onStop = () => {
          this.users.delete(filter);
          if (!this.users.size) this.release();
        };
        if (this.background) {
          this.feedBackground(filter);
        } else if (vw.effects?.SOURCE_BACKGROUNDS.includes(background)) {
          this.setBackground(background);
        }
        return { filter };
      });
    }

    release() {
      this.run(async () => {
        if (this.users.size) return;
        this.active?.stop();
        this.active = null;
        this.background?.stop();
        this.background = null;
      });
    }

    // Opens or closes the source shown behind you, for backgrounds that use another source.
    setBackground(mode) {
      this.wantedBackground = mode;
      return this.run(async () => {
        if (mode !== this.wantedBackground) return;
        const kind = vw.effects?.SOURCE_BACKGROUNDS.includes(mode) ? mode : null;
        if ((this.background?.kind ?? null) === kind) return;
        let source = null;
        if (kind && this.users.size) {
          try {
            source = await this.open(kind, "background");
          } catch (e) {
            console.warn(`Virtual webcam: couldn't open the background source (${e.message}).`);
          }
          if (mode !== this.wantedBackground) {
            source?.stop();
            return;
          }
        }
        const previous = this.background;
        this.background = source;
        if (source) {
          source.crop = null;
          source.track.addEventListener("ended", () => this.backgroundEnded(source));
          source.onEnded?.(() => this.backgroundEnded(source));
          source.watchCrop?.((rect) => {
            source.crop = rect;
            if (this.background === source) this.users.forEach((filter) => filter.setBackgroundCrop(rect));
          });
        }
        this.users.forEach((filter) => this.feedBackground(filter));
        previous?.stop();
      });
    }

    feedBackground(filter) {
      const source = this.background;
      if (!source) {
        filter.setBackgroundTrack(null);
        return;
      }
      const { track, stop } = this.lease(source);
      filter.setBackgroundTrack(track, stop);
      filter.setBackgroundCrop(source.crop ?? null);
    }

    backgroundEnded(source) {
      if (source !== this.background) return;
      this.background = null;
      source.stop();
      this.users.forEach((filter) => filter.setBackgroundTrack(null));
      console.info("Virtual webcam: the background source ended.");
    }

    switchTo(kind) {
      this.wantedKind = kind;
      return this.run(async () => {
        if (kind !== this.wantedKind || !this.users.size) return;
        if (this.active && !this.active.ended && this.active.kind === kind) return;
        let source;
        try {
          source = await this.open(kind);
        } catch (e) {
          console.warn(`Virtual webcam: couldn't switch to the new source (${e.message}). Keeping the current one.`);
          return;
        }
        if (kind !== this.wantedKind || !this.users.size) {
          source.stop();
          return;
        }
        this.activate(source);
      });
    }

    ended(source) {
      if (source !== this.active || source.ended) return;
      source.ended = true;
      source.stop();
      this.users.forEach((filter) => filter.showPlaceholder());
      this.offerReplacement(source);
    }

    async offerReplacement(source) {
      if (!vw.extension || !this.users.size) return;
      let choice = null;
      try {
        choice = await vw.extension.request("source-ended", { kind: source.kind }, 120000);
      } catch {}
      if (this.active !== source) return;
      if (choice === "camera") {
        vw.extension.request("set-source", { source: "camera" }).catch(() => {});
        this.switchTo("camera");
      } else if (choice === "again") {
        this.switchTo(source.kind);
      }
    }
  }

  vw.SourceManager = SourceManager;
})();
