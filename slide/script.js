(() => {
  const deck = document.getElementById("deck");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const prevButton = document.getElementById("prevButton");
  const nextButton = document.getElementById("nextButton");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const counter = document.getElementById("slideCounter");
  const progressBar = document.getElementById("progressBar");

  const totalSlides = slides.length;
  const requestedSlide = Number.parseInt(new URLSearchParams(window.location.search).get("slide") || "1", 10);
  let currentIndex = 0;

  const pad = (value) => String(value).padStart(2, "0");

  function fitDeck() {
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    document.documentElement.style.setProperty("--deck-scale", scale.toFixed(4));
  }

  function showSlide(nextIndex) {
    const boundedIndex = Math.max(0, Math.min(nextIndex, totalSlides - 1));

    slides.forEach((slide, index) => {
      slide.classList.toggle("is-active", index === boundedIndex);
      slide.setAttribute("aria-hidden", index === boundedIndex ? "false" : "true");
    });

    currentIndex = boundedIndex;
    counter.textContent = `${pad(currentIndex + 1)} / ${pad(totalSlides)}`;
    progressBar.style.width = `${((currentIndex + 1) / totalSlides) * 100}%`;
    prevButton.disabled = currentIndex === 0;
    nextButton.disabled = currentIndex === totalSlides - 1;
    requestAnimationFrame(positionContextConnector);
  }

  function nextSlide() {
    showSlide(currentIndex + 1);
  }

  function prevSlide() {
    showSlide(currentIndex - 1);
  }

  function setupDemoVideo() {
    const videoFrame = document.querySelector("[data-video-url]");
    const rawUrl = videoFrame?.dataset.videoUrl?.trim();

    if (!videoFrame || !rawUrl) {
      return;
    }

    const driveMatch = rawUrl.match(/\/d\/([^/]+)/) || rawUrl.match(/[?&]id=([^&]+)/);
    const embedUrl = driveMatch
      ? `https://drive.google.com/file/d/${driveMatch[1]}/preview`
      : rawUrl;
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl;
    iframe.title = "Video demo VietBridge AI";
    iframe.allow = "autoplay; fullscreen";
    iframe.allowFullscreen = true;
    videoFrame.replaceChildren(iframe);
  }

  function positionContextConnector() {
    const thread = document.querySelector(".context-chat-thread");
    const connector = thread?.querySelector(".context-connector-line");
    const path = connector?.querySelector("path");
    const bubbles = thread?.querySelectorAll(".context-chat-bubble");

    if (!thread || !connector || !path || !bubbles || bubbles.length < 2) {
      return;
    }

    const threadRect = thread.getBoundingClientRect();
    const firstRect = bubbles[0].getBoundingClientRect();
    const secondRect = bubbles[1].getBoundingClientRect();
    const scaleX = threadRect.width ? thread.offsetWidth / threadRect.width : 1;
    const scaleY = threadRect.height ? thread.offsetHeight / threadRect.height : 1;
    const startX = (firstRect.left + firstRect.width / 2 - threadRect.left) * scaleX;
    const startY = (firstRect.bottom - threadRect.top) * scaleY + 2;
    const endX = (secondRect.left + secondRect.width / 2 - threadRect.left) * scaleX;
    const endY = (secondRect.top - threadRect.top) * scaleY - 2;
    const middleY = startY + (endY - startY) / 2;
    const direction = endX >= startX ? 1 : -1;
    const radius = Math.min(8, Math.abs(endX - startX) / 4);

    connector.setAttribute("viewBox", `0 0 ${thread.offsetWidth} ${thread.offsetHeight}`);
    path.setAttribute(
      "d",
      `M ${startX} ${startY} V ${middleY - radius} ` +
      `Q ${startX} ${middleY} ${startX + direction * radius} ${middleY} ` +
      `H ${endX - direction * radius} ` +
      `Q ${endX} ${middleY} ${endX} ${middleY + radius} V ${endY}`
    );
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      return;
    }

    document.exitFullscreen?.();
  }

  function handleKeydown(event) {
    const key = event.key;
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isEditable = activeTag === "input" || activeTag === "textarea" || document.activeElement?.isContentEditable;

    if (isEditable) {
      return;
    }

    if (key === "ArrowRight" || key === " ") {
      event.preventDefault();
      nextSlide();
      return;
    }

    if (key === "ArrowLeft") {
      event.preventDefault();
      prevSlide();
      return;
    }

    if (key === "Home") {
      event.preventDefault();
      showSlide(0);
      return;
    }

    if (key === "End") {
      event.preventDefault();
      showSlide(totalSlides - 1);
    }
  }

  setupDemoVideo();
  fitDeck();
  showSlide(Number.isFinite(requestedSlide) ? requestedSlide - 1 : 0);

  prevButton.addEventListener("click", prevSlide);
  nextButton.addEventListener("click", nextSlide);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  window.addEventListener("resize", () => {
    fitDeck();
    requestAnimationFrame(positionContextConnector);
  });
  window.addEventListener("load", positionContextConnector);
  document.addEventListener("keydown", handleKeydown);

  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.setAttribute(
      "aria-label",
      document.fullscreenElement ? "Thoát fullscreen" : "Bật fullscreen"
    );
    fitDeck();
  });

    deck.setAttribute("aria-label", `Bộ slide VietBridge AI, ${totalSlides} slide`);
})();
