// A moving test card with a face-like shape, used for previews when no camera is open.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});
  const pattern = document.createElement("canvas");
  pattern.width = 640;
  pattern.height = 480;
  const patternContext = pattern.getContext("2d");

  function drawPattern(time) {
    const ctx = patternContext;
    const { width, height } = pattern;

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#2b5f9e");
    sky.addColorStop(1, "#f2b880");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const bars = ["#ffffff", "#ffd400", "#00c8d6", "#2fb34a", "#d43fb5", "#e0352b", "#2242c7", "#111111"];
    bars.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect((i * width) / bars.length, 0, width / bars.length + 1, 70);
    });

    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 70);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }

    const cx = width / 2 + Math.sin(time * 0.8) * 140;
    const cy = 280;
    const head = ctx.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, 110);
    head.addColorStop(0, "#ffe0c2");
    head.addColorStop(1, "#b9714a");
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 85, 105, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#2a1a12";
    for (const dx of [-30, 30]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, cy - 20, 9, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#7a2f25";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy + 25, 32, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, height - 44, width, 44);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Virtual Webcam", 16, height - 22);
  }

  vw.testPattern = {
    canvas: pattern,
    draw(time = performance.now() / 1000) {
      drawPattern(time);
      return pattern;
    },
  };
})();
