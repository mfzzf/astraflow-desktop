# Bundled Python runtime

AstraFlow packages a private, relocatable CPython runtime for each desktop
target. It is built from the checksummed
[`astral-sh/python-build-standalone`](https://github.com/astral-sh/python-build-standalone)
archive declared in `runtime-manifest.json`, then populated from the exact
universal dependency lock in `requirements.lock`.

The runtime is read-only after packaging. Agent commands receive its `bin`
directory first in `PATH`, `PYTHONNOUSERSITE=1`, and session-scoped HOME,
cache, and temporary directories. This prevents user-site packages and host
Python configuration from changing the environment.

Regenerate the lock after editing `requirements.in`:

```bash
uv pip compile runtime/python/requirements.in \
  --python-version 3.12 \
  --universal \
  --output-file runtime/python/requirements.lock
```

Prepare the current platform runtime with:

```bash
node scripts/prepare-bundled-python.mjs
```

LibreOffice and Poppler are intentionally not part of this runtime yet.
