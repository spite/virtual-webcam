import { FilterStream } from './filter-stream.js';

// Ideally we'd use an editor or import shaders directly from the API.
import { distortedTV as shader } from './distorted-tv.js';
//import { moneyFilter as shader } from './money-filter.js';


async function findPreferredWebcamID(){

  // List cameras and microphones to find the one we want to apply the shader to
  // See https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices
  let targetDeviceId = 0;

  const devices = await navigator.mediaDevices.enumerateDevices();

  let index = 0;
  devices.forEach(function(device) {
    console.log(device);

    if (device.kind == "videoinput") {
       // Order seems to be preserved, so this should work consistently
       // Here I am just arbitrarily using the second one
      if (index == 1){
        targetDeviceId = device.deviceId;
        console.log("Using target device!", targetDeviceId);
      }
      index++;
    }
  });

  return targetDeviceId;
}

function monkeyPatchMediaDevices(preferredId) {

  const enumerateDevicesFn = MediaDevices.prototype.enumerateDevices;
  const getUserMediaFn = MediaDevices.prototype.getUserMedia;

  MediaDevices.prototype.enumerateDevices = async function () {
    const res = await enumerateDevicesFn.call(navigator.mediaDevices);
    res.push({
      deviceId: "virtual",
      groupID: "uh",
      kind: "videoinput",
      label: "Shader Webcam",
    });
    return res;
  };

  // Do the actual monkeypatching
  MediaDevices.prototype.getUserMedia = async function () {
    const args = arguments;
    console.log("getUserMedia() called with arguments: ");
    console.log(args[0]);

    if (args.length && args[0].video && args[0].video.deviceId) {
      if (
        args[0].video.deviceId === "virtual" ||
        args[0].video.deviceId.exact === "virtual"
      ) {

        // This constraints could mimick closely the request.
        // Also, there could be a preferred webcam on the options.
        // Right now it defaults to the one we want to apply the shader to
        const constraints = {
          video: {
            deviceId: preferredId,
            facingMode: args[0].facingMode,
            advanced: args[0].video.advanced,
            width: args[0].video.width,
            height: args[0].video.height,
          },
          audio: false,
        };

        const res = await getUserMediaFn.call(
          navigator.mediaDevices,
          constraints
        );

        // Apply the shader
        if (res) {
          const filter = new FilterStream(res, shader);
          return filter.outputStream;
        }
      }

    }
    const res = await getUserMediaFn.call(navigator.mediaDevices, ...arguments);
    return res;
  };

  console.log('VIRTUAL WEBCAM INSTALLED.')
}

export { monkeyPatchMediaDevices, findPreferredWebcamID }