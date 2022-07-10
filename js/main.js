import { monkeyPatchMediaDevices, findPreferredWebcamID } from './media-devices.js';

findPreferredWebcamID().then(targetDeviceId => {
    console.log("targetDeviceId: ", targetDeviceId);
    monkeyPatchMediaDevices(targetDeviceId);
})
//.catch(error => {
//    console.error(`Failed to find preferred camera: ${error}`);
//});
