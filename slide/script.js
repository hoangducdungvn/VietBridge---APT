(() => {
  const deck = document.getElementById("deck");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const prevButton = document.getElementById("prevButton");
  const nextButton = document.getElementById("nextButton");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const counter = document.getElementById("slideCounter");
  const progressBar = document.getElementById("progressBar");
  const dotNav = document.getElementById("dotNav");

  const totalSlides = slides.length;
  let currentIndex = 0;

  const pad = (value) => String(value).padStart(2, "0");

  function fitDeck() {
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    document.documentElement.style.setProperty("--deck-scale", scale.toFixed(4));
  }

  function updateDots(index) {
    Array.from(dotNav.children).forEach((dot, dotIndex) => {
      const active = dotIndex === index;
      dot.setAttribute("aria-current", active ? "true" : "false");
      dot.setAttribute("tabindex", active ? "0" : "-1");
    });
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
    updateDots(currentIndex);
  }

  function nextSlide() {
    showSlide(currentIndex + 1);
  }

  function prevSlide() {
    showSlide(currentIndex - 1);
  }

  function buildDots() {
    dotNav.innerHTML = ""; // Clear existing dots
    slides.forEach((slide, index) => {
      const button = document.createElement("button");
      const title = slide.dataset.title || `Slide ${index + 1}`;
      button.type = "button";
      button.setAttribute("aria-label", `Đến slide ${index + 1}: ${title}`);
      button.addEventListener("click", () => showSlide(index));
      dotNav.appendChild(button);
    });
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

  buildDots();
  fitDeck();
  showSlide(0);

  prevButton.addEventListener("click", prevSlide);
  nextButton.addEventListener("click", nextSlide);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  window.addEventListener("resize", fitDeck);
  document.addEventListener("keydown", handleKeydown);

  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.setAttribute(
      "aria-label",
      document.fullscreenElement ? "Thoát fullscreen" : "Bật fullscreen"
    );
    fitDeck();
  });

  deck.setAttribute("aria-label", `VietBridge AI pitch deck, ${totalSlides} slides`);
})();
