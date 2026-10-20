"""Job plumbing of the Blender entry points (render.py, render_icons.py). No bpy, no effect on pixels.

    with job_dir(job) as out:                     # the job's temporary directory, removed if the job raises
        ... load the model, render into out ...
        check_sources(job, script)                # every model file it loaded is declared
        finish(job, out, record)                  # record.json last, then the directory is renamed into place

  * Atomic jobs (codex C6-r1 finding 8): a job renders into `<out>.tmp-<pid>` and becomes `<out>` only when it has
    finished, with record.json written last. A failed or interrupted job leaves no directory the build could take
    for a render; a forced re-render replaces the old one only on success.
  * Declared dependencies (finding 6): each job starts with the model modules of earlier jobs unloaded, so its
    imports run again, and every module it loads from game/assets/blender/ (except lib/, which every render key
    hashes, and this file) must be among the job's declared `sources` (plan.py's transitive scan). An undeclared
    one fails the job instead of leaving a cache entry that would outlive an edit of that file.
  * Exceptions propagate: the build runs Blender with --python-exit-code 1, so any failure exits non-zero.
"""

import contextlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, '..', '..'))
SHARED = {os.path.join(HERE, 'jobs.py'), os.path.join(HERE, 'render.py'), os.path.join(HERE, 'render_icons.py')}


def _ours(mod):
    f = getattr(mod, '__file__', None)
    if not f:
        return None
    f = os.path.abspath(f)
    if not f.startswith(HERE + os.sep) or f in SHARED or f.startswith(os.path.join(HERE, 'lib') + os.sep):
        return None
    return f


def unload_models():
    """Forget the model modules (not lib/) that earlier jobs imported, so this job's imports run and show."""
    for name, mod in list(sys.modules.items()):
        if _ours(mod):
            del sys.modules[name]


def loaded_models():
    return sorted({f for mod in list(sys.modules.values()) if (f := _ours(mod))})


def check_sources(job, script_path):
    """Every model file the job loaded must be declared in its sources (paths relative to game/)."""
    declared = {os.path.abspath(os.path.join(GAME, p)) for p in job.get('sources') or []}
    declared.add(os.path.abspath(script_path))
    extra = [os.path.relpath(f, GAME) for f in loaded_models() if f not in declared]
    if extra:
        raise RuntimeError(f'{job["set"]}: loaded model files its plan does not declare: {extra} (plan.py scans '
                           f'imports; use plain import statements)')


def start(job):
    """The job's temporary output directory (empty)."""
    out = job['out']
    tmp = f'{out}.tmp-{os.getpid()}'
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    unload_models()
    return tmp


@contextlib.contextmanager
def job_dir(job):
    """start(job) as a context: a job that raises leaves no temporary directory behind (the exception goes on)."""
    tmp = start(job)
    try:
        yield tmp
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def finish(job, tmp, record):
    """record.json last, then the directory replaces any old render of this key."""
    with open(os.path.join(tmp, 'record.json.tmp'), 'w') as f:
        json.dump(record, f, indent=1, sort_keys=True)
    os.replace(os.path.join(tmp, 'record.json.tmp'), os.path.join(tmp, 'record.json'))
    out = job['out']
    old = f'{out}.old-{os.getpid()}'
    if os.path.exists(out):
        os.replace(out, old)
    os.replace(tmp, out)
    shutil.rmtree(old, ignore_errors=True)
