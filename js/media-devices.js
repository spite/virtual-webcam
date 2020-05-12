import { FilterStream } from './filter-stream.js';

// Ideally we'd use an editor or import shaders directly from the API.
import { distortedTV as shader } from './distorted-tv.js';
//import { moneyFilter as shader } from './money-filter.js';

function monkeyPatchMediaDevices() {

  const enumerateDevicesFn = MediaDevices.prototype.enumerateDevices;
  const getUserMediaFn = MediaDevices.prototype.getUserMedia;

  MediaDevices.prototype.enumerateDevices = async function () {
    const res = await enumerateDevicesFn.call(navigator.mediaDevices);
    // We could add "Virtual VHS" or "Virtual Median Filter" and map devices with filters.
    res.push({
      deviceId: "virtual",
      groupID: "uh",
      kind: "videoinput",
      label: "Virtual Chrome Webcam",
    });
    return res;
  };

  MediaDevices.prototype.getUserMedia = async function (userConstrains, ...args) {
    console.log(userConstrains);
    if (userConstrains && userConstrains.video && userConstrains.video.deviceId) {
      if (
        userConstrains.video.deviceId === "virtual" ||
        userConstrains.video.deviceId.exact === "virtual"
      ) {
        // This constraints could mimick closely the request.
        // Also, there could be a preferred webcam on the options.
        // Right now it defaults to the predefined input.
        const constraints = {
          video: {
            facingMode: userConstrains.facingMode,
            advanced: userConstrains.video.advanced,
            width: userConstrains.video.width,
            height: userConstrains.video.height,
          },
          audio: false,
        };
        const res = await getUserMediaFn.call(
          navigator.mediaDevices,
          constraints
        );
        if (res) {
          const filter = new FilterStream(res, shader);
          return filter.outputStream;
        }
      }
    }
    const res = await getUserMediaFn.call(navigator.mediaDevices, userConstrains, ...args);
    return res;
  };

  console.log('VIRTUAL WEBCAM INSTALLED.')
}

export { monkeyPatchMediaDevices }