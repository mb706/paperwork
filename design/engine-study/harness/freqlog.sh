#!/bin/bash
# Log socket 0's clock every 2 s (all cores of a package share one frequency on Ivy Bridge-EP):
# "<unix ms> <cpu0 MHz>" lines to results/freq.log. Runs pinned to socket 1 so it never disturbs socket 0.
# The host grants turbo (up to 3.4 GHz) only intermittently and otherwise runs at its 2.6 GHz base clock.
cd "$(dirname "$0")/.."
while true; do
  echo "$(date +%s%3N) $(( $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq) / 1000 ))" >> results/freq.log
  sleep 2
done
