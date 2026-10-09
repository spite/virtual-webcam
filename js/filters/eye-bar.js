(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  vw.addFilter({
    id: "eye-bar",
    name: "Eye bar",
    language: "js",
    source: `
// A black bar over the eyes that follows each face, using MediaPipe's face landmarker.
let landmarker;

async function setup({ mediapipe }) {
  landmarker = await mediapipe.faceLandmarker({ numFaces: 4 });
}

function draw(frame, ctx, { time, width, height }) {
  ctx.drawImage(frame, 0, 0, width, height);
  const { faceLandmarks } = landmarker.detectForVideo(frame, time);
  ctx.fillStyle = "#000";
  for (const points of faceLandmarks) {
    // Outer corners of the two eyes.
    const a = points[33];
    const b = points[263];
    const dx = (b.x - a.x) * width;
    const dy = (b.y - a.y) * height;
    const span = Math.hypot(dx, dy);
    ctx.save();
    ctx.translate((a.x + b.x) / 2 * width, (a.y + b.y) / 2 * height);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillRect(-span * 0.8, -span * 0.2, span * 1.6, span * 0.4);
    ctx.restore();
  }
}
`,
  });
})();
