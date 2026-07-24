# AstraFlow bundled skills

These user-supplied skills are packaged with AstraFlow Desktop, registered on
first use, and copied into a session-local read-only skill area before their
scripts run. `manifest.json` pins every bundled file by SHA-256 so packaging or
local tampering fails verification.

The bundle contains document skills (`docx`, `pdf`, `pptx`, `xlsx`), design
skills (`ardot-*`), financial data skills (`finance-skill`, `westock-data`,
`westock-tool`), and utility skills (`expert-manager`, `skill-creator`).
AstraFlow's build does not download their source from a third-party repository.
Ownership and release terms remain under the project owner's control.
