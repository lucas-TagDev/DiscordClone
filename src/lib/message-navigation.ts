// Follow newly rendered messages and delayed media only while the reader is at
// the bottom. Reading older messages and explicit search navigation keep control.
export const followTimelineBottom = (
  container: HTMLDivElement,
  shouldFollow: () => boolean,
): (() => void) => {
  let stopped = false;
  const align = () => {
    if (!stopped && shouldFollow() && container.clientHeight > 0) {
      container.scrollTop = container.scrollHeight;
    }
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(align);
  const observeRows = () => {
    resizeObserver?.disconnect();
    resizeObserver?.observe(container);
    for (const child of Array.from(container.children)) resizeObserver?.observe(child);
  };
  const mutations = new MutationObserver(() => { observeRows(); align(); });
  mutations.observe(container, { childList: true, subtree: true });
  observeRows();
  container.addEventListener("load", align, true);
  container.addEventListener("loadedmetadata", align, true);
  align();
  return () => {
    stopped = true;
    resizeObserver?.disconnect();
    mutations.disconnect();
    container.removeEventListener("load", align, true);
    container.removeEventListener("loadedmetadata", align, true);
  };
};

// Keep the selected message visible while images and link previews change row heights.
export const revealTimelineMessage = (
  container: HTMLDivElement,
  messageId: string,
  onSettled: (found: boolean) => void,
): (() => void) => {
  let stopped = false;
  let found = false;
  let frame = 0;
  let settleTimer = 0;
  let highlighted: HTMLElement | undefined;
  const findTarget = () => Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
    .find((element) => element.dataset.messageId === messageId);

  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(settleTimer);
    window.clearTimeout(deadline);
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) container.removeEventListener(event, finish);
    container.removeEventListener("load", schedule, true);
    container.removeEventListener("loadedmetadata", schedule, true);
    container.removeEventListener("error", schedule, true);
    highlighted?.classList.remove("message-flash");
  };
  const finish = () => {
    if (stopped) return;
    cleanup();
    onSettled(found);
  };
  const align = () => {
    if (stopped) return;
    const target = findTarget();
    if (!target || container.clientHeight === 0) return;
    found = true;
    const bounds = container.getBoundingClientRect();
    const row = target.getBoundingClientRect();
    // For long messages show the beginning rather than the middle of the text.
    const inset = row.height > container.clientHeight - 32 ? 16 : (container.clientHeight - row.height) / 2;
    container.scrollTop = Math.max(0, container.scrollTop + row.top - bounds.top - container.clientTop - inset);
    if (highlighted !== target) {
      highlighted?.classList.remove("message-flash");
      target.classList.add("message-flash");
      highlighted = target;
    }
    window.clearTimeout(settleTimer);
    const loadingImages = Array.from(container.querySelectorAll("img")).some((image) => !image.complete);
    if (!loadingImages) settleTimer = window.setTimeout(finish, 1200);
  };
  function schedule() {
    if (stopped) return;
    window.clearTimeout(settleTimer);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(align);
  }
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  const observeRows = () => {
    resizeObserver?.observe(container);
    for (const row of Array.from(container.children)) resizeObserver?.observe(row);
  };
  const mutationObserver = new MutationObserver(() => { observeRows(); schedule(); });
  mutationObserver.observe(container, { childList: true, subtree: true });
  observeRows();
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) container.addEventListener(event, finish, { passive: true });
  container.addEventListener("load", schedule, true);
  container.addEventListener("loadedmetadata", schedule, true);
  container.addEventListener("error", schedule, true);
  const deadline = window.setTimeout(finish, 8000);
  align();
  schedule();
  return cleanup;
};
