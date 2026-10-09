// Keeps the chosen video file and background image in the extension's IndexedDB.
(() => {
  const vw = (globalThis.__virtualWebcam ??= {});

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("virtual-webcam", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("files", mode);
        const request = action(transaction.objectStore("files"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }

  // key is "video" or "background-image".
  vw.videoStore = {
    get: (key = "video") => run("readonly", (store) => store.get(key)),
    put: (file, key = "video") => run("readwrite", (store) => store.put(file, key)),
    delete: (key = "video") => run("readwrite", (store) => store.delete(key)),
  };
})();
