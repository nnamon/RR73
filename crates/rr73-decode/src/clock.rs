//! Stage timing. `std::time::Instant` panics on `wasm32-unknown-unknown`, so there the
//! stopwatch reads the clock an embedder sets with [`set_clock`], and zero without one.

/// The clock stage timings read on wasm32, in seconds.
#[cfg(target_arch = "wasm32")]
static CLOCK: std::sync::OnceLock<fn() -> f64> = std::sync::OnceLock::new();

/// Sets the clock that stage timings read on wasm32: a function giving seconds from any fixed
/// origin, such as `performance.now() / 1000` in a browser. The first call wins. Without a
/// clock the timings read zero. Other targets time with `std::time::Instant` and ignore it.
pub fn set_clock(clock: fn() -> f64) {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = CLOCK.set(clock);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = clock;
    }
}

/// A started stopwatch.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Stopwatch {
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
    #[cfg(target_arch = "wasm32")]
    start: f64,
}

impl Stopwatch {
    /// Starts timing.
    #[inline]
    pub(crate) fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
            #[cfg(target_arch = "wasm32")]
            start: CLOCK.get().map_or(0.0, |clock| clock()),
        }
    }

    /// Seconds since `start`.
    #[inline]
    pub(crate) fn elapsed_s(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.start.elapsed().as_secs_f64()
        }
        #[cfg(target_arch = "wasm32")]
        {
            CLOCK.get().map_or(0.0, |clock| clock() - self.start)
        }
    }
}
