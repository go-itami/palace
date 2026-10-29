#!/usr/bin/env python3
"""Zero-dependency localhost backend for Palace Studio.

Usage: python ui/server.py --port 8765
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from exporter import MAX_SCENE_BYTES, SceneError, files_for_scene, generate_config, validate, zip_files

ROOT = Path(__file__).resolve().parent
RUNS = ROOT / '.runs'
JOBS: dict[str, dict] = {}
JOB_LOCK = threading.Lock()
MAX_RUNNING = 2
GMSH_BIN = os.environ.get('GMSH_BIN', 'gmsh')
PALACE_BIN = os.environ.get('PALACE_BIN', 'palace')


def installed(binname: str) -> bool:
    return bool(shutil.which(binname))


def parse_eigen_csv(path: Path):
    """Keep native Palace results; do not fabricate or extrapolate solver values."""
    if not path.exists():
        return []
    with path.open(newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(line for line in f if not line.lstrip().startswith('#'))
        result = []
        for row in reader:
            if not row:
                continue
            try:
                keys = list(row)
                index_key = next((k for k in keys if k.strip() == 'm'), keys[0])
                freq_key = next(k for k in keys if 'Re{f}' in k)
                q_key = next((k for k in keys if k.strip() == 'Q'), None)
                item = {"mode": int(float(row[index_key])), "frequencyGHz": float(row[freq_key])}
                if q_key:
                    item["q"] = float(row[q_key])
                result.append(item)
            except (ValueError, TypeError, StopIteration):
                continue
        return result


def benchmarks():
    """Find pre-existing cylinder eigenmode CSVs without altering the repository."""
    folder = ROOT.parent / 'verification' / 'cylinder'
    if not folder.is_dir():
        return []
    files = []
    for path in sorted(folder.rglob('eig.csv')):
        if not path.is_file() or not path.resolve().is_relative_to(folder.resolve()):
            continue
        relative = str(path.relative_to(ROOT.parent))
        files.append({'id': hashlib.sha256(relative.encode()).hexdigest()[:16], 'path': relative, 'file': path})
        if len(files) >= 30:
            break
    return files


def job_summary(job: dict) -> dict:
    return {k: v for k, v in job.items() if k in ('id', 'state', 'step', 'started', 'finished', 'error', 'log')}


def run_job(job_id: str, scene: dict):
    with JOB_LOCK:
        job = JOBS[job_id]
        job['state'] = 'running'
        job['step'] = 'Writing Palace input files'
    run_dir = RUNS / job_id
    try:
        run_dir.mkdir(parents=True, exist_ok=False)
        for name, contents in files_for_scene(scene).items():
            (run_dir / name).write_bytes(contents)
        commands = [([GMSH_BIN, '-3', 'model.geo', '-format', 'msh2', '-o', 'mesh.msh'], 'Generating curved tetrahedral mesh'),
                    ([PALACE_BIN, 'config.json'], 'Solving eigenmodes with Palace')]
        for cmd, label in commands:
            with JOB_LOCK:
                job['step'] = label
            result = subprocess.run(cmd, cwd=run_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace', timeout=1800)
            with JOB_LOCK:
                job['log'] = (job['log'] + '\n$ ' + ' '.join(cmd) + '\n' + result.stdout)[-100000:]
            if result.returncode:
                raise RuntimeError(f'{label} failed with exit code {result.returncode}')
        rows = parse_eigen_csv(run_dir / 'postpro' / 'eig.csv')
        with JOB_LOCK:
            job['state'] = 'completed'
            job['step'] = f'Finished • {len(rows)} eigenmode records'
            job['results'] = rows
            job['finished'] = int(time.time())
    except Exception as exc:
        with JOB_LOCK:
            job['state'] = 'failed'
            job['error'] = str(exc)
            job['log'] = (job['log'] + '\n' + traceback.format_exc())[-100000:]
            job['finished'] = int(time.time())


class Handler(BaseHTTPRequestHandler):
    server_version = 'PalaceStudio/0.1'

    def send_data(self, code: int, body: bytes, mime: str, name: str | None = None):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        if name:
            self.send_header('Content-Disposition', f'attachment; filename="{name}"')
        self.end_headers()
        self.wfile.write(body)

    def json_out(self, code: int, value):
        self.send_data(code, json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8'), 'application/json; charset=utf-8')

    def read_scene(self):
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise SceneError('invalid content length')
        if n <= 0 or n > MAX_SCENE_BYTES:
            raise SceneError('scene exceeds size limit or is empty')
        try:
            return json.loads(self.rfile.read(n))
        except (ValueError, UnicodeDecodeError):
            raise SceneError('invalid JSON') from None

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/api/benchmarks':
            return self.json_out(200, {'benchmarks': [{'id': b['id'], 'path': b['path']} for b in benchmarks()]})
        if path.startswith('/api/benchmarks/'):
            ident = path.rsplit('/', 1)[-1]
            source = next((b for b in benchmarks() if b['id'] == ident), None)
            if source is None:
                return self.json_out(404, {'error': 'benchmark not found'})
            return self.json_out(200, {'path': source['path'], 'results': parse_eigen_csv(source['file'])})
        if path == '/api/health':
            return self.json_out(200, {"status": "ok", "gmsh": installed(GMSH_BIN), "palace": installed(PALACE_BIN), "backend": "local", "version": "0.1.0"})
        if path.startswith('/api/jobs/'):
            parts = path.strip('/').split('/')
            if len(parts) not in (3, 4):
                return self.json_out(404, {"error": "unknown endpoint"})
            with JOB_LOCK:
                job = JOBS.get(parts[2])
                if not job:
                    return self.json_out(404, {"error": "job not found"})
                info = job_summary(job)
                results = job.get('results', [])
            if len(parts) == 3:
                return self.json_out(200, {**info, "results": results})
            if parts[3] == 'download' and job['state'] == 'completed':
                run_dir = RUNS / parts[2]
                content = {}
                for p in run_dir.rglob('*'):
                    if p.is_file() and p.stat().st_size < 30_000_000:
                        content[str(p.relative_to(run_dir))] = p.read_bytes()
                return self.send_data(200, zip_files(content), 'application/zip', f'palace-result-{parts[2][:8]}.zip')
            return self.json_out(404, {"error": "results not ready"})
        if path == '/':
            path = '/index.html'
        allowed = {'/index.html', '/app.js', '/style.css', '/favicon.svg'}
        if path not in allowed:
            return self.json_out(404, {"error": "not found"})
        file = (ROOT / path.removeprefix('/'))
        if not file.exists():
            return self.json_out(404, {"error": "not found"})
        mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}[file.suffix]
        self.send_data(200, file.read_bytes(), mime)

    def do_POST(self):
        try:
            scene = self.read_scene()
            if self.path == '/api/validate':
                checked = validate(scene)
                return self.json_out(200, {'valid': True, 'config': generate_config(checked)})
            if self.path == '/api/export':
                files = files_for_scene(scene)
                return self.send_data(200, zip_files(files), 'application/zip', 'palace-eigenmode-input.zip')
            if self.path == '/api/run':
                files_for_scene(scene)  # validate before creating job
                if not installed(GMSH_BIN) or not installed(PALACE_BIN):
                    return self.json_out(422, {"error": "Gmsh and Palace must be installed on this machine for local solve. You can still Export Input ZIP."})
                with JOB_LOCK:
                    if sum(1 for job in JOBS.values() if job['state'] in ('queued', 'running')) >= MAX_RUNNING:
                        return self.json_out(429, {"error": "too many simultaneous jobs"})
                    job_id = str(uuid.uuid4())
                    JOBS[job_id] = {'id': job_id, 'state': 'queued', 'step': 'Queued', 'started': int(time.time()), 'log': '', 'results': []}
                threading.Thread(target=run_job, args=(job_id, scene), daemon=True).start()
                return self.json_out(202, {"id": job_id, "state": "queued"})
            return self.json_out(404, {"error": "unknown endpoint"})
        except SceneError as exc:
            return self.json_out(422, {"error": str(exc)})
        except Exception:
            traceback.print_exc()
            return self.json_out(500, {"error": "internal server error"})

    def log_message(self, fmt, *args):
        print('[Palace Studio]', fmt % args)


def main():
    parser = argparse.ArgumentParser(description='Local Palace Studio GUI')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', default='127.0.0.1', help='Default localhost-only. Do not expose the execution API publicly.')
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Palace Studio → http://{args.host}:{args.port} (Gmsh={installed(GMSH_BIN)}, Palace={installed(PALACE_BIN)})', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping…')
        httpd.shutdown()

if __name__ == '__main__':
    main()
