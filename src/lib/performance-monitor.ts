export function installPerformanceMonitor() {
  if (typeof window === "undefined") return;
  if (!import.meta.env.DEV) return;
  if (!("PerformanceObserver" in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 100) continue;
        console.warn("[perf] long task", {
          durationMs: Math.round(entry.duration),
          startMs: Math.round(entry.startTime),
          name: entry.name,
        });
      }
    });

    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
  } catch {
    // Long Task API is browser-dependent.
  }
}
