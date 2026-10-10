(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  const VIRTUAL_ID = "virtual";
  const VIRTUAL_GROUP_ID = "virtual";
  const VIRTUAL_LABEL = "Virtual Chrome Webcam";
  const PATCHED = Symbol.for("virtual-webcam");

  function isVirtualId(value) {
    if (value == null) return false;
    if (typeof value === "string") return value === VIRTUAL_ID;
    if (Array.isArray(value)) return value.includes(VIRTUAL_ID);
    return isVirtualId(value.exact) || isVirtualId(value.ideal);
  }

  function requestsVirtual(video) {
    return isVirtualId(video.deviceId) ||
      (video.advanced ?? []).some((set) => isVirtualId(set.deviceId));
  }

  function namesDevice(video) {
    return video.deviceId != null ||
      (video.advanced ?? []).some((set) => set.deviceId != null);
  }

  function withoutDeviceId(video) {
    const { deviceId, ...rest } = video;
    if (rest.advanced) {
      rest.advanced = rest.advanced.map(({ deviceId, ...set }) => set);
    }
    return rest;
  }

  // Mirrors the real cameras: no label or group until the page has camera permission.
  function createVirtualDevice(permitted) {
    const info = {
      deviceId: VIRTUAL_ID,
      kind: "videoinput",
      label: permitted ? VIRTUAL_LABEL : "",
      groupId: permitted ? VIRTUAL_GROUP_ID : "",
    };
    const props = {
      toJSON: { value: () => ({ ...info }) },
      getCapabilities: { value: () => ({ deviceId: info.deviceId, groupId: info.groupId }) },
    };
    for (const [key, value] of Object.entries(info)) {
      props[key] = { value, enumerable: true };
    }
    const proto = (globalThis.InputDeviceInfo ?? MediaDeviceInfo).prototype;
    return Object.create(proto, props);
  }

  // The filter stops once the app has stopped every copy of its track, clones included.
  function disguiseTrack(track, filter) {
    const getSettings = track.getSettings.bind(track);
    const stop = track.stop.bind(track);
    const clone = track.clone.bind(track);
    let released = false;
    filter.copies = (filter.copies ?? 0) + 1;
    Object.defineProperties(track, {
      label: { value: VIRTUAL_LABEL },
      getSettings: {
        value: () => ({ ...getSettings(), deviceId: VIRTUAL_ID, groupId: VIRTUAL_GROUP_ID }),
      },
      clone: {
        value: () => disguiseTrack(clone(), filter),
      },
      stop: {
        value: () => {
          stop();
          if (released) return;
          released = true;
          if (--filter.copies === 0) filter.stop();
        },
      },
    });
    return track;
  }

  // settings: { ready: Promise, current(): { virtualDefault, camera, flip, background, effects, backgroundImage }, onChange(listener) }
  function monkeyPatchMediaDevices(settings) {
    if (MediaDevices.prototype[PATCHED]) return;
    Object.defineProperty(MediaDevices.prototype, PATCHED, { value: true });

    const { FilterStream } = vw;
    const filters = new Set();
    const getUserMediaFn = MediaDevices.prototype.getUserMedia;
    const manager = new vw.SourceManager((c) => getUserMediaFn.call(navigator.mediaDevices, c));

    const isVirtualDefault = async () => {
      await settings.ready;
      return settings.current().virtualDefault;
    };

    let applying = Promise.resolve();
    // Applies the filter, flip and effects to every running stream, in order, so a slow processor load can't land late.
    const applySettings = () => {
      applying = applying.then(async () => {
        const plan = vw.effects.plan(settings.current());
        for (const filter of filters) {
          if (filter.stopped) filters.delete(filter);
        }
        const processor = filters.size ? await vw.effects.sync(plan) : null;
        for (const filter of filters) {
          filter.setEffects(plan.effects);
          filter.setFlip(plan.flip);
          filter.setProcessing(processor);
        }
      });
      return applying;
    };

    let main = null;
    let secondary;
    settings.onChange(() => {
      const plan = vw.effects.plan(settings.current());
      applySettings();
      if (main !== null && plan.main !== main) manager.switchTo(plan.main);
      if (main !== null && plan.secondary !== secondary) manager.setBackground(plan.secondary);
      main = plan.main;
      secondary = plan.secondary;
    });
    const enumerateDevicesFn = MediaDevices.prototype.enumerateDevices;

    MediaDevices.prototype.enumerateDevices = async function () {
      const devices = await enumerateDevicesFn.call(this);
      const cameras = devices.filter((device) => device.kind === "videoinput");
      if (cameras.length) {
        const device = createVirtualDevice(cameras.some((camera) => camera.label));
        // Listed first so apps that pick the first camera pick it.
        if (await isVirtualDefault()) {
          devices.splice(devices.indexOf(cameras[0]), 0, device);
        } else {
          devices.push(device);
        }
      }
      return devices;
    };

    MediaDevices.prototype.getUserMedia = async function (constraints) {
      const requested = constraints?.video;
      const video = typeof requested === "object" && requested ? requested : {};
      const useVirtual = requested && (
        requestsVirtual(video) || (!namesDevice(video) && await isVirtualDefault())
      );
      if (!useVirtual) {
        return getUserMediaFn.call(this, constraints);
      }

      await settings.ready;
      const plan = vw.effects.plan(settings.current());
      const result = await manager.start(plan.main, withoutDeviceId(video), (track, stop) => {
        const filter = new FilterStream(track, vw.PASSTHROUGH_SHADER, stop);
        filter.setEffects(plan.effects);
        filter.setFlip(plan.flip);
        return filter;
      }, plan.secondary);

      let audioTracks = [];
      if (constraints.audio) {
        try {
          audioTracks = (await getUserMediaFn.call(this, { audio: constraints.audio })).getAudioTracks();
        } catch (e) {
          if (result.filter) {
            result.filter.stop();
          } else {
            result.track.stop();
          }
          throw e;
        }
      }
      if (!result.filter) return new MediaStream([result.track, ...audioTracks]);
      filters.add(result.filter);
      applySettings();
      return new MediaStream([
        disguiseTrack(result.filter.outputTrack, result.filter),
        ...audioTracks,
      ]);
    };
  }

  vw.monkeyPatchMediaDevices = monkeyPatchMediaDevices;
})();
