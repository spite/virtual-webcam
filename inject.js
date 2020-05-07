function inject(source) {
  const script = document.createElement('script');
  script.textContent = source;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.onload = function () {
    script.parentNode.removeChild(script);
  };
}

// webcam icon by Paomedia https://www.iconfinder.com/icons/299109/webcam_icon

function source() {

  console.log('HAI')

  class FilterStream {
    constructor(stream) {
      console.log('New Filter for stream', stream);
      this.stream = stream;
      const video = document.createElement('video');
      video.addEventListener('playing', () => {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.update();
      });
      video.srcObject = stream;
      video.autoplay = true;
      this.video = video;
      const canvas = document.createElement('canvas');
      this.canvas = canvas;
      this.ctx = this.canvas.getContext('2d');
      this.outputStream = this.canvas.captureStream();
    }

    update() {
      this.ctx.filter = 'invert(1)';
      this.ctx.drawImage(this.video, 0, 0);
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText('Virtual', 10, 10)
      requestAnimationFrame(() => this.update());
    }
  }

  const enumerateDevicesFn = MediaDevices.prototype.enumerateDevices;
  const getUserMediaFn = MediaDevices.prototype.getUserMedia;

  MediaDevices.prototype.enumerateDevices = async function () {
    const res = await enumerateDevicesFn.call(navigator.mediaDevices);
    res.push({
      deviceId: "virtual",
      groupID: "uh",
      kind: "videoinput",
      label: "Virtual Chrome Webcam"
    });
    return res;
  }

  MediaDevices.prototype.getUserMedia = async function () {
    const args = arguments;
    console.log(args[0]);
    if (args.length && args[0].video && args[0].video.deviceId && args[0].video.deviceId.exact === 'virtual') {
      const constraints = { video: { facingMode: args[0].facingMode, advanced: args[0].video.advanced, width: args[0].video.width, height: args[0].video.height }, audio: false };
      const res = await getUserMediaFn.call(navigator.mediaDevices, constraints);
      if (res) {
        const filter = new FilterStream(res);
        return filter.outputStream;
      }
    }
    const res = await getUserMediaFn.call(navigator.mediaDevices, ...arguments);
    return res;
  }

}

inject(`${source};source();`);