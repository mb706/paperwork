//! Native reference benchmark: `bench <world.bin> <warmup> <ticks> [nosleep] [nophase]`. Prints one JSON line.
use sim::World;
use std::time::Instant;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 4 {
        eprintln!("usage: bench <world.bin> <warmup> <ticks> [nosleep]");
        std::process::exit(2);
    }
    let bytes = std::fs::read(&a[1]).expect("read world");
    let warm: u32 = a[2].parse().unwrap();
    let ticks: usize = a[3].parse().unwrap();
    let nosleep = a.iter().any(|s| s == "nosleep");
    let t0 = Instant::now();
    let mut w = World::new(&bytes);
    let load_ms = t0.elapsed().as_secs_f64() * 1e3;
    w.set_no_sleep(nosleep);
    let t1 = Instant::now();
    w.run(warm);
    let warm_ms = t1.elapsed().as_secs_f64() * 1e3;
    let mut times = Vec::with_capacity(ticks);
    for _ in 0..ticks {
        let s = Instant::now();
        w.step();
        times.push(s.elapsed().as_secs_f64() * 1e3);
    }
    let hash = w.hash();
    let stats = w.stats();
    // phase breakdown over a second window of the same length
    w.timing = true;
    w.run(ticks as u32);
    let ph: Vec<String> = w.phase_ms.iter().map(|v| format!("{:.6}", v / ticks as f64)).collect();
    let mut sorted = times.clone();
    sorted.sort_by(|x, y| x.total_cmp(y));
    let mean = times.iter().sum::<f64>() / ticks as f64;
    let q = |p: f64| sorted[((ticks as f64 - 1.0) * p).round() as usize];
    let st: Vec<String> = stats.iter().map(|v| format!("{v}")).collect();
    println!(
        "{{\"impl\":\"native\",\"loadMs\":{load_ms:.3},\"warmMs\":{warm_ms:.1},\"ticks\":{ticks},\"mean\":{mean:.6},\"p50\":{:.6},\"p99\":{:.6},\"max\":{:.6},\"hash\":\"{hash:08x}\",\"hashTick\":{},\"stats\":[{}],\"phases\":[{}]}}",
        q(0.5),
        q(0.99),
        sorted[ticks - 1],
        stats[0] as i64,
        st.join(","),
        ph.join(",")
    );
}
