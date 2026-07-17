export const TOOL_GROUNDING_RULE =
  "Do not claim files, logs, templates, command output, test results, or benchmark results were read unless a tool output in this conversation actually contains them. If a tool fails or returns not found, report that failure instead of filling in details."

export const SKILL_FILE_ACCESS_RULE =
  "For AstraFlow Skills, call load_skill before following a skill. Read bundled files with read_skill_file when that tool is available; never guess or fabricate skill file paths, and never use local read_file/ls on sandbox skill paths such as /home/user/astraflow/skills."

export const SECRET_FILE_HANDLING_RULE =
  "For key.txt, .env, and other API key or secret files, never cat, echo, print, grep, sed, head, tail, or otherwise display their contents. Run commands with `set -a && source key.txt && set +a && <command>` when the user asks to use their key."

export const PYTHON_PACKAGE_INSTALL_RULE =
  'Use the configured AstraFlow Python interpreter for Python work. Install a missing package only when the task needs it and the user has approved execution; when ASTRAFLOW_PYTHON_REQUIREMENTS is available, constrain pip with `python -m pip install --constraint "$ASTRAFLOW_PYTHON_REQUIREMENTS" <package>` so AstraFlow\'s required package versions are not replaced.'

export const FILE_DELIVERY_RULE =
  "When download_file is available and you are delivering a standalone generated or requested artifact for the user to open or download, call it first. If the tool result includes both Preview and Download Markdown links, reproduce both exact links in the final response; never provide only the download for a previewable file. If the tool returns only Download, provide that link without inventing a preview URL. Do not use download_file for ordinary repository edits."

export const AGENT_CONDUCT_RULES = [
  TOOL_GROUNDING_RULE,
  SKILL_FILE_ACCESS_RULE,
  SECRET_FILE_HANDLING_RULE,
  PYTHON_PACKAGE_INSTALL_RULE,
  FILE_DELIVERY_RULE,
]

export function formatAgentConductRules({ bullet = "- " } = {}) {
  return AGENT_CONDUCT_RULES.map((rule) => `${bullet}${rule}`).join("\n")
}
