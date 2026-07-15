# Bundled Python runtime

AstraFlow packages a small, private, relocatable CPython and pip bootstrap for
each desktop target. It is built from the checksummed
[`astral-sh/python-build-standalone`](https://github.com/astral-sh/python-build-standalone)
archive declared in `runtime-manifest.json`. Document and data packages are
not stored in the app bundle: after launch, the desktop app creates a managed
environment in its user-data directory and installs the exact universal lock
from `requirements.lock`.

The bootstrap is read-only after packaging. Once the managed environment is
ready, Agent commands and local sandboxes receive that environment's `bin`
directory first in `PATH`. Users can select an existing interpreter from the
Environment settings page; AstraFlow validates it before making it active.

The Environment page can query compatible package versions through the active
interpreter's `pip index`, install a selected version, and show which packages
come from AstraFlow versus the user. Managed custom packages are recorded in
`python-user-packages.json` under Electron user data and are restored when the
managed environment is rebuilt. Local Agent commands use the same interpreter;
in managed mode the OS sandbox permits package writes only inside that managed
environment and network access only to `pypi.org` and
`files.pythonhosted.org`. Agent installs should pass `requirements.lock` as a
constraint so application-owned versions stay intact.

`bootstrap-requirements.txt` contains only platform tools needed to assemble
the local sandbox runtime. Do not add document packages to it.

Regenerate the lock after editing `requirements.in`:

```bash
uv pip compile runtime/python/requirements.in \
  --python-version 3.12 \
  --universal \
  --output-file runtime/python/requirements.lock
```

Prepare the current platform bootstrap with:

```bash
node scripts/prepare-bundled-python.mjs
```

LibreOffice and Poppler are intentionally not part of the desktop bootstrap.
They are preinstalled in the remote sandbox template where OS packages are
available.
