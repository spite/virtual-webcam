// Embedded by a page that needs a stored file (the video file or background image); hands it over once the token checks out.
(async () => {
  const token = location.hash.slice(1);
  const parentOrigin = location.ancestorOrigins?.[0];
  const target = parentOrigin && parentOrigin !== "null" ? parentOrigin : "*";
  const reply = (data) => parent.postMessage({ type: "virtual-webcam-file", token, ...data }, target);

  try {
    const key = await chrome.runtime.sendMessage({ type: "redeem-file-token", token });
    if (!key) {
      reply({ error: "The page isn't allowed to use this file." });
      return;
    }
    const file = await globalThis.__virtualWebcam.videoStore.get(key);
    reply(file ? { blob: file } : { error: key === "video" ? "No video file has been chosen." : "No background image has been chosen." });
  } catch (e) {
    reply({ error: String(e?.message ?? e) });
  }
})();
