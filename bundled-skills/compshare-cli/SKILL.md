---
name: compshare-cli
description: Manage CompShare GPU cloud resources through the bundled compshare CLI. Use when Codex needs to search GPU inventory and pricing, create or manage instances, connect over SSH, transfer files, run durable jobs, manage images, disks, US3, teams or billing, answer product questions, or diagnose CLI problems.
---

# CompShare CLI

Manage CompShare GPU compute through AstraFlow's CompShare CLI Agent tools.

## AstraFlow integration

- AstraFlow Desktop bundles CompShare CLI v0.3.5. Do not install or upgrade it unless the user explicitly asks.
- CompShare OAuth login provisions the CLI credential profile automatically through `ListUserAccessKeys`.
- Never print, log, inspect, or commit the CLI credential file or API credentials.
- If authentication is unavailable, ask the user to sign in to CompShare from AstraFlow. Do not run interactive `compshare config` unless the user explicitly wants to replace the managed credentials.
- For Agent work, use `compshare_cli_query` and `compshare_cli_action`; do not run the `compshare` executable through a shell. The Desktop host tools keep credentials outside the Agent sandbox and work for local and remote Agents.

## Mandatory permission boundary

- `compshare_cli_query` accepts only a server-enforced allowlist of read-only inspection commands and does not require a prompt.
- Every operation that is not purely a query must use `compshare_cli_action`. This includes create, start, stop, reboot, wait-changing workflows, rename, password reset, reinstall, resize, charge changes, schedule changes, job submission or cancellation, SSH command execution, file transfer, image sharing/favorites, storage changes, team changes, feedback, and deletion.
- `compshare_cli_action` is an important action. AstraFlow Desktop must show a one-time user approval prompt before every call, even in Full Access mode. Never split, disguise, or route an action through the query tool or a shell to avoid that prompt.
- A dry run still uses the action tool because it invokes a non-query command. Explain that it is a dry run in the request.
- Query current state first when useful. After approval, execute exactly the reviewed command and arguments. If arguments or scope change materially, request approval again.

## Operating rules

- The host tools add `compshare --json` automatically. Pass only the enumerated command and its argument array.
- Build the complete argument array before calling a tool. Do not discover required options by repeatedly submitting an incomplete command and adding one flag per error.
- Use the query tool's enumerated commands and the exact examples below instead of guessing positional arguments or abbreviated flags.
- `instance search` always requires both `--region` and `--zone`. If the user did not give a location, query `instance zones` first; never guess one.
- `instance price` requires `--gpu`, `--cpu`, `--memory`, `--region`, and `--zone` in the first call. Memory uses `--memory` with a unit such as `64GiB`; there is no `--mem` option.
- Inspect resources and prices before changing them. Use `instance create --dry-run` before a real create operation.
- Add `--yes` only when the user has authorized the mutation. Deletion, stopping, reinstalling, resizing, and similar operations can require confirmation.
- Use explicit timeouts for creation, lifecycle waits, and remote jobs. After a timeout, inspect the resource before retrying because the remote operation may still be running.
- Keep sensitive output redacted. Do not use `--show-sensitive` unless the user explicitly needs the raw password, IP, access URL, or login command.

## Check availability

Call `compshare_cli_query` with `command: "doctor"`. If the tool is unavailable or reports missing credentials, ask the user to install AstraFlow's managed Python runtime or complete CompShare OAuth login, then retry.

## Discover current commands

The command lines below are compact argument references only. Do not execute
them through a shell. Translate the command path and remaining flags into the
matching Desktop host-tool call. The Desktop tool descriptions contain the
supported Agent argument forms; do not pass `--help` to a Desktop tool because
CLI help is human-readable text rather than a JSON result.

```bash
compshare --json --help
compshare --json instance --help
compshare --json instance create --help
compshare --json image list --help
```

Global options:

- `--json`: emit the stable machine-readable response envelope.
- `--profile NAME`: select a credential profile.
- `--lang zh|en`: select the output language; JSON error codes remain language-independent.
- `--show-sensitive`: reveal normally redacted fields; avoid by default.
- `--version`: print the CLI version.

## Create an instance

Discover locations and images, then search legal specifications and real inventory:

```bash
compshare --json instance zones
compshare --json image list \
  --source platform \
  --region cn-sh2 \
  --zone cn-sh2-02 \
  --all
compshare --json instance search \
  --region cn-sh2 \
  --zone cn-sh2-02 \
  --gpu 4090 \
  --image IMAGE_ID \
  --available
```

`--image` makes `instance search` check real inventory. Without it, the command lists legal specifications only. Search does not filter CPU or memory; validate the exact CPU and memory combination with the create dry run.

When answering a generic question such as “现在还有多少 4090 库存？”, use
this sequence rather than guessing `cn-sh2` or calling search with positional
`4090`:

1. `instance zones` with `[]`.
2. `instance search` with `["--region", REGION, "--zone", ZONE, "--gpu", "4090"]`.
3. For real stock, select a suitable image using `image list`, then repeat
   search with `["--region", REGION, "--zone", ZONE, "--gpu", "4090",
   "--image", IMAGE_ID, "--available"]`.

Query a complete price specification in one call:

```json
{
  "command": "instance price",
  "arguments": [
    "--gpu", "4090",
    "--cpu", "16",
    "--memory", "64GiB",
    "--region", "cn-sh2",
    "--zone", "cn-sh2-02"
  ]
}
```

Build and inspect the create plan without changing resources:

```bash
compshare --json instance create \
  --region cn-sh2 \
  --zone cn-sh2-02 \
  --gpu 4090 \
  --count 1 \
  --cpu 16 \
  --memory 64GiB \
  --image IMAGE_ID \
  --image-source platform \
  --disk 100GiB \
  --charge Postpay \
  --max-count 1 \
  --max-price 20 \
  --dry-run
```

Review the returned selection, capacity, price, and request. If the user approves it, rerun without `--dry-run` and add `--yes` plus an explicit timeout:

```bash
compshare --json instance create \
  --region cn-sh2 \
  --zone cn-sh2-02 \
  --gpu 4090 \
  --count 1 \
  --cpu 16 \
  --memory 64GiB \
  --image IMAGE_ID \
  --image-source platform \
  --disk 100GiB \
  --charge Postpay \
  --max-count 1 \
  --max-price 20 \
  --yes \
  --timeout 900
```

In JSON mode, creation cannot open the interactive wizard. Supply `--gpu`, `--count`, `--cpu`, `--memory`, `--image`, `--region`, and `--zone`. Here `--count` is GPUs per instance; `--max-count` is the number of instances.

## Inspect and manage instances

```bash
compshare --json instance list --all
compshare --json instance list --status Running --gpu 4090 --all
compshare --json instance show INSTANCE_ID
compshare --json instance show INSTANCE_ID --status --spec --billing

compshare --json instance start INSTANCE_1 INSTANCE_2 --timeout 600
compshare --json instance stop INSTANCE_1 INSTANCE_2 --yes --timeout 600
compshare --json instance wait INSTANCE_1 INSTANCE_2 --state Running --timeout 600
compshare --json instance delete INSTANCE_ID --yes --timeout 600
```

Use direct instance ID commands without guessing a Region or Zone; the CLI resolves the location. Batch operations report succeeded and failed instances separately and exit nonzero on partial failure.

Other workflows are available under:

```text
instance rename, password, reinstall, resize
instance price, resize-price, billing, refund, charge
instance network, models, ports, schedule, software, template
```

Inspect each workflow with `compshare --json instance COMMAND --help` before invoking it.

## SSH and file transfer

Use `instance ssh` for an interactive shell or a short synchronous command:

```bash
compshare instance ssh INSTANCE_ID
compshare --json instance ssh INSTANCE_ID -- nvidia-smi
compshare --json instance ssh INSTANCE_ID -- sh -lc 'cd /workspace && python train.py'
```

Always place remote command arguments after `--`. Use `sh -lc` only when the remote command needs shell syntax such as pipes, redirects, `&&`, or variable expansion.

Copy a file or directory by prefixing the remote path with `:`:

```bash
compshare --json instance cp INSTANCE_ID ./model.bin :/workspace/model.bin
compshare --json instance cp INSTANCE_ID ./dataset :/workspace/dataset
compshare --json instance cp INSTANCE_ID :/workspace/results ./results
```

The CLI automatically resolves and caches SSH connection data. Use `--refresh` after a password reset or reinstall, and `--no-cache` when cached connection data must not be used.

## Durable remote jobs

Use `instance job` for work that must survive a local terminal or network disconnect:

```bash
compshare --json instance job submit INSTANCE_ID \
  --name training \
  --cwd /workspace/project \
  -- python train.py --epochs 100

compshare --json instance job list INSTANCE_ID
compshare --json instance job show INSTANCE_ID JOB_ID
compshare --json instance job logs INSTANCE_ID JOB_ID --tail 200
compshare --json instance job wait INSTANCE_ID JOB_ID --timeout 3600
```

Use `--follow` for live logs. For incremental reads, use byte offsets from the previous JSON response:

```bash
compshare --json instance job logs INSTANCE_ID JOB_ID \
  --stdout-offset STDOUT_OFFSET \
  --stderr-offset STDERR_OFFSET \
  --limit 65536
```

Cancel or prune jobs only when authorized:

```bash
compshare --json instance job cancel INSTANCE_ID JOB_ID --yes
compshare --json instance job prune INSTANCE_ID --older-than 7d --yes
```

A job wait timeout does not cancel the remote job. Query its state before submitting replacement work.

## Images, storage, and teams

```bash
compshare --json image --help
compshare --json storage --help
compshare --json storage disk --help
compshare --json team --help
```

Common entry points:

```text
image list/show/create/progress/update/delete/share/unshare/publish
storage disk list/create/attach/detach/price/resize/delete
storage us3 attach
team list/joined/show/create/update/delete/audit
team invite/member/quota/billing
```

Treat image deletion, disk deletion, disk detach/resize, quota changes, and team mutations as state-changing operations. Read the current resource and request confirmation before adding `--yes` where supported.

## Product questions and diagnostics

```bash
compshare --json ask '按量实例关机以后，云硬盘还收费吗？'
compshare --json doctor
compshare feedback bug '创建实例时发生错误'
```

Use `feedback` only when the user asks to send feedback; it performs an external write.

## JSON contract

Successful commands return one UTF-8 JSON document shaped like:

```json
{
  "ok": true,
  "schema_version": "1",
  "data": {}
}
```

Failures return `ok: false` with a stable `error.code`, a human-readable `error.message`, and optional `error.details`. List commands place rows in `data.items` and pagination or API metadata in `meta`. Check the process exit code as well as `ok`; batch operations can fail partially.

## Troubleshooting

- Authentication failure: ask the user to sign in with CompShare OAuth in AstraFlow, then rerun `compshare --json doctor`.
- No available specification: search again with the exact image and `--available`; relax GPU, Region, Zone, CPU, memory, billing, or disk constraints deliberately.
- JSON creation asks for interaction: provide all seven required automation options listed above.
- SSH option parsed by the CLI: insert `--` before the remote command.
- Long SSH command interrupted: resubmit it as an `instance job`.
- Lifecycle or job timeout: inspect current state before retrying; do not assume the remote operation stopped.
- Unexpected option or output: query `compshare --json COMMAND --help` and follow the installed version.
