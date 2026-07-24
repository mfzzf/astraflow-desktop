# AstraFlow bundled skills

These user-supplied skills are packaged with AstraFlow Desktop, registered on
first use, and copied into a session-local read-only skill area before their
scripts run. `manifest.json` pins every bundled file by SHA-256 so packaging or
local tampering fails verification.

The bundle contains document skills (`docx`, `pdf`, `pptx`, `xlsx`), design
skills (`ardot-*`), financial data skills (`finance-skill`, `westock-data`,
`westock-tool`), utility skills (`expert-manager`, `skill-creator`), and the
`compshare-cli` GPU cloud management skill.
AstraFlow's build does not download their source from a third-party repository.
Most skills remain under the project owner's release terms. The CompShare CLI
skill is adapted from `compshare-cn/compshare-cli` v0.3.5 and distributed under
Apache-2.0; its source and license notice are stored beside the skill.
