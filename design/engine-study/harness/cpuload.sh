#!/bin/bash
# Per-CPU utilisation over an interval, from /proc/stat (mpstat is not installed on this host).
# Usage: cpuload.sh [seconds=2]   Prints busy% per CPU, grouped by socket, plus the load average.
# Socket 0 = CPUs 0-7 (cores) + 16-23 (HT siblings); socket 1 = 8-15 + 24-31 (lscpu -e).
iv=${1:-2}
snap() { grep -E '^cpu[0-9]+ ' /proc/stat | awk '{t=0; for(i=2;i<=NF;i++) t+=$i; idle=$5+$6; print $1, t, idle}'; }
a=$(snap); sleep "$iv"; b=$(snap)
paste <(echo "$a") <(echo "$b") | awk -v iv="$iv" '
{ cpu=substr($1,4)+0; dt=$5-$2; di=$6-$3; busy[cpu]=(dt>0)?100*(dt-di)/dt:0 }
END {
  printf "socket0 cores 0-7 :"; s=0; for(c=0;c<8;c++){printf " %3.0f", busy[c]; s+=busy[c]} printf "  | mean %5.1f%%\n", s/8
  printf "socket0 HT  16-23 :"; s=0; for(c=16;c<24;c++){printf " %3.0f", busy[c]; s+=busy[c]} printf "  | mean %5.1f%%\n", s/8
  printf "socket1 cores 8-15:"; s=0; for(c=8;c<16;c++){printf " %3.0f", busy[c]; s+=busy[c]} printf "  | mean %5.1f%%\n", s/8
  printf "socket1 HT  24-31 :"; s=0; for(c=24;c<32;c++){printf " %3.0f", busy[c]; s+=busy[c]} printf "  | mean %5.1f%%\n", s/8
}'
echo "loadavg: $(cut -d' ' -f1-3 /proc/loadavg)"
