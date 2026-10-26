#!/usr/bin/env python3
"""Check Palace cylinder eig.csv outputs against analytic frequencies and dielectric Q.

Usage: python3 scripts/verify_cavity.py path/to/eig.csv [another/eig.csv ...]
This is a benchmark check, not an HFSS comparison or a general accuracy guarantee.
"""
import argparse
import csv
import json
import math
from pathlib import Path


def check(path, tolerance=0.01):
    with path.open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.reader(stream)
        header = [item.strip() for item in next(reader)]
        fi = header.index('Re{f} (GHz)')
        qi = header.index('Q')
        values = [(float(row[fi]), float(row[qi])) for row in reader if row]
    if len(values) < 3:
        raise ValueError(f'{path}: expected at least 3 eigenmodes, got {len(values)}')
    if any(not math.isfinite(f) or not math.isfinite(q) or f <= 0 or q <= 0
           for f, q in values):
        raise ValueError(f'{path}: nonfinite or nonpositive frequency/Q')
    rows = []
    for index, ((frequency, quality), reference) in enumerate(
            zip(sorted(values)[:3], (2.903605, 2.922212, 2.922212)), start=1):
        error = abs(frequency / reference - 1)
        q_error = abs(quality / 2500 - 1)
        rows.append(dict(source=str(path), mode=index, frequency_GHz=frequency,
                         analytic_GHz=reference, relative_error=error, Q=quality,
                         Q_relative_error=q_error,
                         passed=error < tolerance and q_error < tolerance))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', nargs='+', type=Path)
    parser.add_argument('--tolerance', type=float, default=0.01,
                        help='Relative frequency and Q error limit (default: 0.01)')
    parser.add_argument('--output', type=Path, help='Optional JSON report path')
    args = parser.parse_args()
    if not math.isfinite(args.tolerance) or not 0 < args.tolerance < 1:
        parser.error('--tolerance must be finite and between 0 and 1')
    try:
        rows = [row for path in args.csv for row in check(path, args.tolerance)]
    except (OSError, ValueError, IndexError, StopIteration) as exc:
        parser.exit(2, f'Invalid result data: {exc}\n')
    report = dict(benchmark='dielectric PEC cylinder', hfss_compared=False,
                  tolerance=args.tolerance, passed=all(row['passed'] for row in rows),
                  results=rows)
    payload = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if args.output:
        args.output.write_text(payload, encoding='utf-8')
    print(payload, end='')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
