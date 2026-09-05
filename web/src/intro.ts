/**
 * The title sequence, played once before the app opens.
 *
 * Three rules, in order of importance:
 *
 *  1. It plays in full. Nothing here cuts it short, and nothing skips it by
 *     accident -- a stray tap on a phone must not throw away the thing the
 *     audience came to see. Only the Skip button ends it early.
 *  2. It never blocks the app. A missing file, a codec the browser will not
 *     take, a stall on bad wifi: every one of those falls through to the app
 *     rather than leaving somebody looking at a black rectangle on stage.
 *  3. It tries for sound. Phones refuse to autoplay audio without a gesture,
 *     which cannot be coded around -- so it asks for sound first, and only if
 *     the browser says no does it fall back to muted and offer a button. That
 *     button restarts from the beginning, so the sound is heard over the whole
 *     film rather than joining it halfway.
 */

/** How long to wait for the first frame before giving up and opening the app. */
const START_TIMEOUT_MS = 8000;

export function playIntro(src: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("fading");
      // Let the fade run, but never wait on it: if the transition never fires
      // (a background tab, reduced motion) the app still opens.
      setTimeout(() => overlay.remove(), 320);
      resolve();
    };

    const overlay = document.createElement("div");
    overlay.className = "intro";
    overlay.innerHTML = `
      <video id="intro-video" playsinline preload="auto"
             disablepictureinpicture></video>
      <button class="intro-skip" id="intro-skip" type="button">Skip</button>
      <button class="intro-sound" id="intro-sound" type="button" hidden>
        Tap for sound
      </button>`;
    document.body.appendChild(overlay);

    const video = overlay.querySelector<HTMLVideoElement>("#intro-video")!;
    const sound = overlay.querySelector<HTMLButtonElement>("#intro-sound")!;

    // If it has not started by now something is wrong -- a stalled download, a
    // file that is not there. Open the app rather than hold the screen.
    const timer = setTimeout(() => {
      if (video.currentTime === 0) finish();
    }, START_TIMEOUT_MS);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);

    overlay.querySelector("#intro-skip")!.addEventListener("click", finish);

    sound.addEventListener("click", () => {
      sound.hidden = true;
      video.muted = false;
      // Back to the start, so the sound is heard over the whole thing.
      video.currentTime = 0;
      void video.play().catch(() => {});
    });

    video.addEventListener("ended", finish);
    // A file that will not load or decode is not worth a message. Open the app.
    video.addEventListener("error", finish);

    video.src = src;
    // Ask for sound. Desktop browsers usually allow it; phones usually do not,
    // and reject the promise rather than playing silently, which is what makes
    // this detectable at all.
    video.muted = false;
    video.play().catch(() => {
      video.muted = true;
      sound.hidden = false;
      void video.play().catch(finish);
    });
  });
}
