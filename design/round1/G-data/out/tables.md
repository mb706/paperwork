**Reference takeoff (medium overhang = 100 halls, active player): every tech**

| Tech | Done at (min) | Took | Doubling time of R | R after (units/s) | Binding before | Halls | Power for compute (MW) |
|---|---|---|---|---|---|---|---|
| Generation 1 | 18.40 | 18.4 min | 10.0 min | 6.00 | cooling | 205 | 1030 |
| Two-phase cooling | 19.38 | 59 s |  | 6.33 | cooling | 208 | 1030 |
| Generation 2 | 28.47 | 9.1 min | 8.4 min | 13.73 | power | 235 | 1030 |
| Accelerator 2 | 29.13 | 39 s |  | 13.73 | power | 237 | 1030 |
| Generation 3 | 34.84 | 5.7 min | 4.6 min | 36.13 | compute | 237 | 1510 |
| Fleet scheduling | 35.21 | 22 s |  | 36.40 | compute | 237 | 1510 |
| Generation 4 | 38.78 | 3.6 min | 3.5 min | 78.67 | compute | 237 | 1510 |
| Fusion power | 39.03 | 15 s |  | 79.20 | compute | 237 | 1510 |
| Generation 5 | 41.53 | 2.5 min | 2.6 min | 166 | compute | 237 | 1990 |
| Sparse inference | 41.72 | 11 s |  | 167 | compute | 237 | 1990 |
| Generation 6 | 43.51 | 1.8 min | 1.9 min | 345 | compute | 237 | 1990 |
| Accelerator 3 | 43.64 | 8 s |  | 345 | compute | 237 | 1990 |
| Generation 7 | 44.90 | 76 s | 75 s | 749 | compute | 237 | 1990 |
| Microfluidic cooling | 44.99 | 5 s |  | 764 | compute | 237 | 1990 |
| Generation 8 | 45.87 | 53 s | 54 s | 1,587 | compute | 237 | 1990 |
| Deployer | 45.94 | 4 s |  | 1,587 | compute | 237 | 1990 |
| Generation 9 | 46.56 | 38 s | 38 s | 3,354 | compute | 237 | 1990 |
| Nanofabrication | 46.61 | 3 s |  | 3,413 | compute | 237 | 1990 |
| Generation 10 | 47.05 | 26 s | 26 s | 7,305 | compute | 237 | 1990 |
| Accelerator 4 | 47.08 | 2 s |  | 7,305 | compute | 237 | 1990 |
| Generation 11 | 47.37 | 18 s | 17 s | 16,555 | compute | 237 | 1990 |
| Reversible logic | 47.39 | 1 s |  | 16,555 | compute | 237 | 1990 |
| Generation 12 | 47.59 | 12 s | 12 s | 35,703 | compute | 237 | 1990 |
| Generation 13 | 47.73 | 8 s | 8 s | 76,595 | compute | 237 | 1990 |
| Generation 14 | 47.83 | 6 s | 6 s | 158,379 | compute | 237 | 1990 |
| Generation 15 | 47.91 | 4 s | 4 s | 327,134 | compute | 237 | 1990 |
| Generation 16 | 47.96 | 3 s | 3 s | 654,268 | compute | 237 | 1990 |
| Generation 17 | 48.00 | 2 s | 2 s | 1.35e+06 | compute | 237 | 1990 |
| Generation 18 | 48.03 | 2 s | 2 s | 2.70e+06 | compute | 237 | 1990 |
| Generation 19 | 48.05 | 1 s | 1 s | 5.40e+06 | compute | 237 | 1990 |
| Generation 20 | 48.07 | 0.99 s | 0.99 s | 1.08e+07 | compute | 237 | 1990 |
| Capstone | 48.08 | 0.74 s |  | 1.08e+07 | compute | 237 | 1990 |

**Brakes: the same closure state, different builders**

| Builder | Takeoff (min) | vs active | Last 20 techs (min) | Last 10 techs (s) | Time bound by compute / power / cooling / labs (%) |
|---|---|---|---|---|---|
| Active player | 48.1 | 1.00× | 4.4 | 41 | 33 / 33 / 32 / 1 |
| Half-speed builder | 59.1 | 1.23× | 4.3 | 47 | 4 / 68 / 27 / 1 |
| Never builds cooling | 64.7 | 1.34× | 5.0 | 35 | 0 / 12 / 88 / 0 |
| Never builds power | 72.2 | 1.50× | 5.5 | 30 | 0 / 100 / 0 / 0 |
| Chain runs, no building | 74.1 | 1.54× | 9.9 | 128 | 0 / 100 / 0 / 0 |
| No hardware change | 102.7 | 2.14× | 17.8 | 230 | 100 / 0 / 0 / 0 |

**Overhang at closure → takeoff**

| Overhang | Halls at closure | MW idle compute | R at closure (units/s) | Takeoff, active (min) | Takeoff, no building (min) | Last 20 techs (min) | First doubling time | Final doubling time |
|---|---|---|---|---|---|---|---|---|
| small | 25 | 125 | 0.42 | 65.3 | 410.7 | 4.0 | 10.0 min | 0.93 s |
| medium | 100 | 500 | 1.67 | 49.2 | 102.7 | 4.3 | 10.2 min | 0.64 s |
| large | 400 | 2000 | 6.67 | 21.1 | 25.7 | 2.9 | 4.8 min | 0.56 s |
| huge | 1500 | 7500 | 25.00 | 6.0 | 6.8 | 1.0 | 77 s | 0.22 s |

**Overhang sweep (takeoff duration, min)**

| Halls at closure | Active player | No building |
|---|---|---|
| 10 | 69.0 | 1026.7 |
| 15 | 67.7 | 684.5 |
| 25 | 65.3 | 410.7 |
| 40 | 61.8 | 256.7 |
| 60 | 57.4 | 171.1 |
| 100 | 49.2 | 102.7 |
| 160 | 40.3 | 64.2 |
| 250 | 30.2 | 41.1 |
| 400 | 21.1 | 25.7 |
| 630 | 14.3 | 16.3 |
| 1000 | 9.1 | 10.3 |
| 1600 | 5.7 | 6.4 |
| 2500 | 3.6 | 4.1 |
| 4000 | 2.3 | 2.6 |

**Returns to research r = ln m / ln g (g = 1.5): world setting**

| r | m (per Generation) | Active, hardware techs interleaved (min) | Active, Generations first (min) | No building (min) | Last 20 techs, active (min) |
|---|---|---|---|---|---|
| 0.60 | 1.275 | 136 | 373 | never | 56.8 |
| 0.80 | 1.383 | 103 | 213 | 1320 | 32.7 |
| 1.00 | 1.500 | 84 | 132 | 530 | 20.8 |
| 1.25 | 1.660 | 67 | 82 | 234 | 12.5 |
| 1.50 | 1.837 | 55 | 59 | 138 | 7.0 |
| 1.71 | 2.000 | 48 | 49 | 103 | 4.4 |
| 2.00 | 2.250 | 41 | 40 | 77 | 2.1 |
| 2.50 | 2.756 | 33 | 33 | 56 | 0.5 |
| 3.00 | 3.375 | 29 | 28 | 45 | 0.1 |

**The talent plateau makes the overhang (staffing binds at 11 h → capstone)**

| Plateau play | Plateau incl. delay (min) | Halls at closure | Takeoff (min) | Staffing binds → capstone (min) | Capstone at (game h) |
|---|---|---|---|---|---|
| Typical: 0.6 halls/min during the plateau | 138 | 113 | 47.5 | 186 | 14.09 |
| Idle plateau: 0.2 halls/min | 138 | 58 | 57.9 | 196 | 14.26 |
| Compute-first: 1.5 halls/min | 138 | 237 | 31.3 | 169 | 13.82 |
| Talent-first: claim universities twice as fast | 129 | 107 | 48.5 | 177 | 13.95 |
| Talent-first and compute-first | 129 | 223 | 32.6 | 161 | 13.69 |
| Compute-first + 30 min launch delay | 168 | 282 | 27.6 | 196 | 14.26 |
| Compute-first + 90 min launch delay | 228 | 372 | 22.3 | 250 | 15.17 |

**The field's frontier line (typical player: closure 13.3 h, capstone 14.09 h)**

| v₀ (field-years/h) | Field year at your closure | Field loop closes at | Field takeoff complete at | First to finish |
|---|---|---|---|---|
| 2.0 | 66.6 (2012) | 20.0 h | 20.9 h | you by 6.8 h |
| 2.5 | 73.3 (2018) | 16.0 h | 16.7 h | you by 2.6 h |
| 2.75 | 76.6 (2022) | 14.5 h | 15.2 h | you by 66.0 min |
| 2.9 | 78.6 (2024) | 13.8 h | 14.4 h | you by 19.0 min |
| 3.0 | 79.9 (2025) | 13.3 h | 13.9 h | the field by 10.0 min |
| 3.25 | nan (nan) | 12.7 h | 13.1 h | the field by 57.0 min |

**After the capstone: Generation N+ (×1.1 per level, cost ×2), builder continues**

| Minutes after capstone | R (units/s) | Halls | Power for compute (MW) | Doubling time (10-min window) |
|---|---|---|---|---|
| +0 | 1.16e+07 | 226 | 1582 | 33 s |
| +10 | 2.11e+08 | 226 | 3982 | 2.4 min |
| +20 | 6.09e+08 | 539 | 6382 | 6.6 min |
| +30 | 9.55e+08 | 946 | 8782 | 15.4 min |
| +60 | 2.22e+09 | 2432 | 15982 | 41.0 min |
| +90 | 3.96e+09 | 4052 | 27982 | 33.6 min |
| +115 | 5.05e+09 | 5402 | 37582 | 74.5 min |

**Run-report figures, reference run**

| Statistic | Value |
|---|---|
| Takeoff (closure → capstone) | 48.1 min |
| Accelerators at closure (100 halls × 20 + 1,000 stocked) | 3,000 |
| Peak research, technologies per hour (best 10-min window) | 156 |
| Peak research, technologies per hour (best 1-min window) | 720 |
| Doubling time: first Generation → last | 10.0 min → 0.99 s |
| Builder's time on power / cooling / chain / hall space / seminars | 40% / 30% / 14% / 6% / 10% |

Finite-time exponent (frozen hardware): fitted slope d lnR / d ln(t*-t) = -2.18; theory -r/(r-1) = -2.41
