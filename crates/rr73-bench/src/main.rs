//! Decoder research bench: synthesise, run, compare and gate. See `docs/bench.md`.

mod compare;
mod gate;
mod import;
mod results;
mod run;
mod synth;
mod util;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use rr73_decode::{DecoderConfig, PRESETS};

#[derive(Parser)]
#[command(
    name = "rr73-bench",
    version,
    about = "Decoder research bench: synthesise, run, compare and gate"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write named synthetic sets (smoke, noise-ci, noise, snr-sweep, crowded) into the corpus.
    Synth {
        /// Set to write; repeat for several.
        #[arg(long = "set", required = true, value_name = "NAME")]
        sets: Vec<String>,
        /// Corpus directory for synthetic sets.
        #[arg(long, default_value = "corpus/synthetic")]
        out: PathBuf,
        /// Slots in the noise set.
        #[arg(long, default_value_t = 1000)]
        noise_count: usize,
        /// Slots per SNR step and channel in snr-sweep.
        #[arg(long, default_value_t = 40)]
        per_step: usize,
        /// Slots per subset in crowded.
        #[arg(long, default_value_t = 20)]
        crowded_count: usize,
    },
    /// Decode every slot under the paths and write a results file.
    Run {
        /// Decoder preset.
        #[arg(long, default_value = "baseline")]
        preset: String,
        /// Configuration override; repeat for several.
        #[arg(long = "set", value_name = "KEY=VALUE")]
        overrides: Vec<String>,
        /// Results file (default results/<git-sha>-<preset>.json).
        #[arg(long)]
        out: Option<PathBuf>,
        /// Decoder threads (default: all CPUs).
        #[arg(long)]
        threads: Option<usize>,
        /// Reference key to score real slots against (default: the slot's only reference,
        /// else jt9-d3, else the first key).
        #[arg(long)]
        reference: Option<String>,
        /// Decode only the first this many seconds of each slot (early decoding).
        #[arg(long, value_name = "SECONDS")]
        audio_s: Option<f64>,
        /// With --audio-s: `absent` ends the audio there (a partial slot), `zero` pads the
        /// slot with silence.
        #[arg(long, value_enum, default_value_t = run::AudioFill::Absent)]
        audio_fill: run::AudioFill,
        /// Corpus files or directories.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Show decodes gained and lost, false decodes, SNR50 and time per slot between two runs.
    Compare {
        /// Earlier results file.
        a: PathBuf,
        /// Later results file.
        b: PathBuf,
        /// Most gained and most lost decodes listed.
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
    /// Exit with status 1 when results regress beyond the thresholds.
    Gate {
        /// Results to check.
        results: PathBuf,
        /// Baseline results.
        #[arg(long)]
        baseline: PathBuf,
        /// Threshold file.
        #[arg(long, default_value = "bench/gate.toml")]
        thresholds: PathBuf,
    },
    /// Score another decoder's text output (jt9, ft8_lib) on the corpus as a results file.
    Import {
        /// Output file: `== <stem>` lines, each followed by WSJT-X-style decode lines.
        #[arg(long)]
        decodes: PathBuf,
        /// Name recorded as the preset.
        #[arg(long)]
        label: String,
        /// Seconds subtracted from each DT (0.66 for ft8_lib's decode_ft8).
        #[arg(long, default_value_t = 0.0, allow_negative_numbers = true)]
        dt_offset: f64,
        /// Reference key to score real slots against.
        #[arg(long)]
        reference: Option<String>,
        /// Results file to write.
        #[arg(long)]
        out: PathBuf,
        /// Corpus files or directories the output covers.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Write a copy of a results file without per-slot decode and entry lists.
    Slim {
        /// Results file to read.
        results: PathBuf,
        /// File to write.
        #[arg(long)]
        out: PathBuf,
    },
    /// Print a preset's configuration as JSON, or list the presets.
    Presets {
        /// Preset to print.
        name: Option<String>,
    },
}

fn main() -> ExitCode {
    match run_cli(Cli::parse()) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("rr73-bench: {e}");
            ExitCode::from(2)
        }
    }
}

fn run_cli(cli: Cli) -> Result<ExitCode, String> {
    match cli.command {
        Command::Synth {
            sets,
            out,
            noise_count,
            per_step,
            crowded_count,
        } => {
            let opts = synth::SynthOptions {
                noise_count,
                per_step,
                crowded_count,
            };
            for name in &sets {
                let started = std::time::Instant::now();
                let n = synth::synth_set(name, &out, &opts)?;
                println!(
                    "{name}: {n} slots in {} ({:.1} s)",
                    out.join(name).display(),
                    started.elapsed().as_secs_f64()
                );
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Run {
            preset,
            overrides,
            out,
            threads,
            reference,
            audio_s,
            audio_fill,
            paths,
        } => {
            let opts = run::RunOptions {
                preset,
                overrides,
                paths,
                out,
                threads,
                reference,
                audio_s,
                audio_fill,
            };
            let (results, path) = run::run(&opts)?;
            print!("{}", run::summary_table(&results));
            println!(
                "{} slots in {:.1} s on {} thread(s). Results: {}",
                results.slots.len(),
                results.wall_s,
                results.environment.threads,
                path.display()
            );
            Ok(ExitCode::SUCCESS)
        }
        Command::Compare { a, b, limit } => {
            let a = results::load(&a)?;
            let b = results::load(&b)?;
            print!("{}", compare::report(&a, &b, limit));
            Ok(ExitCode::SUCCESS)
        }
        Command::Gate {
            results: path,
            baseline,
            thresholds,
        } => {
            let now = results::load(&path)?;
            let base = results::load(&baseline)?;
            let config = gate::GateConfig::load(&thresholds)?;
            let checks = gate::gate(&now, &base, &config);
            print!("{}", gate::render(&checks));
            Ok(if checks.iter().all(|c| c.pass) {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            })
        }
        Command::Import {
            decodes,
            label,
            dt_offset,
            reference,
            out,
            paths,
        } => {
            let r = import::import(&import::ImportOptions {
                decodes,
                label,
                dt_offset_s: dt_offset,
                paths,
                reference,
                out: out.clone(),
            })?;
            print!("{}", run::summary_table(&r));
            println!("{} slots scored. Results: {}", r.slots.len(), out.display());
            Ok(ExitCode::SUCCESS)
        }
        Command::Slim { results: path, out } => {
            let mut r = results::load(&path)?;
            for s in &mut r.slots {
                s.decodes.clear();
                s.entries.clear();
            }
            r.slim = true;
            results::save(&r, &out)?;
            println!(
                "{} slots, {} sets written to {}",
                r.slots.len(),
                r.sets.len(),
                out.display()
            );
            Ok(ExitCode::SUCCESS)
        }
        Command::Presets { name } => {
            match name {
                Some(n) => {
                    let c = DecoderConfig::preset(&n).map_err(|e| e.to_string())?;
                    println!("{}", serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?);
                }
                None => {
                    for p in PRESETS {
                        println!("{p}");
                    }
                }
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}
