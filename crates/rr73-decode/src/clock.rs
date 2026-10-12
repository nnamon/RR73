//! Stage timing. `std::time::Instant` panics on `wasm32-unknown-unknown`, so there the
//! stopwatch reads zero.

/// A started stopwatch.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Stopwatch {
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
}

impl Stopwatch {
    /// Starts timing.
    #[inline]
    pub(crate) fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
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
            0.0
        }
    }
}
