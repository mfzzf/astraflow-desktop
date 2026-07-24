# AstraFlow bundled skills

These user-supplied skills are packaged with AstraFlow Desktop, registered on
first use, and copied into a session-local read-only skill area before their
scripts run. `manifest.json` pins every bundled file by SHA-256 so packaging or
local tampering fails verification.

The bundle contains `pptx`, `xlsx`, `docx`, `pdf`, and `compshare-cli`.
AstraFlow's build does not download their source from a third-party repository.
The document skills remain under the project owner's release terms. The
CompShare CLI skill is adapted from `compshare-cn/compshare-cli` v0.3.5 and is
distributed under Apache-2.0; its source and license notice are stored beside
the skill.
