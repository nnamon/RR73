//! Decoder research bench: synthesise, run, compare and gate. See `docs/bench.md`.

mod compare;
mod gate;
mod import;
mod loop_fixture;
mod results;
mod rtty;
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
    /// Write the end-to-end decode fixture (a 15 s FT8 loop holding 4 messages 4 times each),
    /// then decode it from start offsets across the loop and check every message comes out.
    LoopFixture {
        /// Fixture path without extension: writes `<out>.wav` and `<out>.json`.
        #[arg(long, default_value = "web/e2e/fixtures/ft8-loop")]
        out: PathBuf,
        /// Check the existing files without writing them.
        #[arg(long)]
        check_only: bool,
        /// Preset to decode with; repeat for several.
        #[arg(long = "preset", default_value = "subtract-3-osd2", value_name = "NAME")]
        presets: Vec<String>,
        /// Time between the start offsets checked, in seconds.
        #[arg(long, default_value_t = 0.05)]
        step_s: f64,
    },
    /// Print a preset's configuration as JSON, or list the presets.
    Presets {
        /// Preset to print.
        name: Option<String>,
    },
    /// RTTY: synthesise transmissions, decode them, score minimodem's output and report.
    Rtty {
        #[command(subcommand)]
        command: RttyCommand,
    },
}

#[derive(Subcommand)]
enum RttyCommand {
    /// Write synthetic RTTY sets (awgn, ccir-good, ccir-moderate, ccir-poor, noise).
    Synth {
        /// Set to write; repeat for several.
        #[arg(long = "set", required = true, value_name = "NAME")]
        sets: Vec<String>,
        /// Directory the sets go in.
        #[arg(long, default_value = "corpus/rtty/synthetic")]
        out: PathBuf,
        /// Transmissions per SNR step.
        #[arg(long, default_value_t = 3)]
        per_step: usize,
        /// Keying time of each transmission, in seconds.
        #[arg(long, default_value_t = 60.0)]
        seconds: f64,
        /// Files in the noise set.
        #[arg(long, default_value_t = 10)]
        noise_files: usize,
    },
    /// Decode RTTY files with rr73-rtty and write a results file.
    Run {
        /// Name in reports.
        #[arg(long, default_value = "rr73")]
        label: String,
        /// Decoder configuration override; repeat for several.
        #[arg(long = "set", value_name = "KEY=VALUE")]
        overrides: Vec<String>,
        /// Decoder threads (default: all CPUs).
        #[arg(long)]
        threads: Option<usize>,
        /// Results file.
        #[arg(long)]
        out: PathBuf,
        /// Files or directories.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Score another decoder's text output (tools/minimodem/decode.sh) as a results file.
    Import {
        /// Name in reports.
        #[arg(long)]
        label: String,
        /// Directory holding `<set>/<stem>.txt` and `<set>/<stem>.time`.
        #[arg(long)]
        texts: PathBuf,
        /// Command line that produced the texts, recorded in the results.
        #[arg(long, default_value = "")]
        command: String,
        /// Results file.
        #[arg(long)]
        out: PathBuf,
        /// Files or directories the texts cover.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Print CER against SNR, false characters on noise and CPU time for results files.
    Report {
        /// Results files, one column each.
        #[arg(required = true)]
        results: Vec<PathBuf>,
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
            paths,
        } => {
            let opts = run::RunOptions {
                preset,
                overrides,
                paths,
                out,
                threads,
                reference,
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
        Command::LoopFixture {
            out,
            check_only,
            presets,
            step_s,
        } => {
            if !check_only {
                let files = loop_fixture::write(&out)?;
                println!("Wrote {} and {}", files.wav.display(), files.json.display());
            }
            let (report, pass) = loop_fixture::check(&out, &presets, step_s)?;
            print!("{report}");
            Ok(if pass {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            })
        }
        Command::Rtty { command } => run_rtty(command),
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

fn run_rtty(command: RttyCommand) -> Result<ExitCode, String> {
    match command {
        RttyCommand::Synth {
            sets,
            out,
            per_step,
            seconds,
            noise_files,
        } => {
            let started = std::time::Instant::now();
            let n = rtty::synth(&rtty::SynthOptions {
                out: out.clone(),
                sets,
                per_step,
                seconds,
                noise_files,
            })?;
            println!(
                "{n} files in {} ({:.1} s)",
                out.display(),
                started.elapsed().as_secs_f64()
            );
        }
        RttyCommand::Run {
            label,
            overrides,
            threads,
            out,
            paths,
        } => {
            let r = rtty::run(&rtty::RunOptions {
                label,
                overrides,
                threads,
                paths,
            })?;
            rtty::save(&r, &out)?;
            print!("{}", rtty::report(std::slice::from_ref(&r)));
            println!("{} files. Results: {}", r.files.len(), out.display());
        }
        RttyCommand::Import {
            label,
            texts,
            command,
            out,
            paths,
        } => {
            let r = rtty::import(&label, &texts, &command, &paths)?;
            rtty::save(&r, &out)?;
            print!("{}", rtty::report(std::slice::from_ref(&r)));
            println!("{} files scored. Results: {}", r.files.len(), out.display());
        }
        RttyCommand::Report { results } => {
            let runs = results
                .iter()
                .map(|p| rtty::load(p))
                .collect::<Result<Vec<_>, _>>()?;
            print!("{}", rtty::report(&runs));
        }
    }
    Ok(ExitCode::SUCCESS)
}
