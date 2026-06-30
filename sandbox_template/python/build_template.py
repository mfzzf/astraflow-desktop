import json
import os

from ucloud_sandbox import Template, default_build_logger


TEMPLATE_NAME = "astraflow-desktop"
BASE_TEMPLATE = "code-interpreter-v1"
DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"
DEFAULT_CPU_COUNT = 2
DEFAULT_MEMORY_MB = 4096


def normalize_domain(value: str | None) -> str | None:
    if not value:
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    return (
        trimmed.removeprefix("https://")
        .removeprefix("http://")
        .removeprefix("*.")
        .rstrip("/")
    )


def read_positive_int(name: str, fallback: int) -> int:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return fallback

    try:
        value = int(raw_value)
    except ValueError:
        return fallback

    return value if value > 0 else fallback


api_key = os.environ.get("UCLOUD_SANDBOX_API_KEY") or os.environ.get("E2B_API_KEY")
domain = normalize_domain(
    os.environ.get("UCLOUD_SANDBOX_DOMAIN")
    or os.environ.get("E2B_DOMAIN")
    or os.environ.get("ASTRAFLOW_SANDBOX_DOMAIN")
    or DEFAULT_DOMAIN
)
cpu_count = read_positive_int("UCLOUD_SANDBOX_TEMPLATE_CPU_COUNT", DEFAULT_CPU_COUNT)
memory_mb = read_positive_int("UCLOUD_SANDBOX_TEMPLATE_MEMORY_MB", DEFAULT_MEMORY_MB)

template = Template().from_template(BASE_TEMPLATE).apt_install(
    ["tmux"], no_install_recommends=True
)

result = Template.build(
    template,
    alias=TEMPLATE_NAME,
    api_key=api_key,
    domain=domain,
    cpu_count=cpu_count,
    memory_mb=memory_mb,
    on_build_logs=default_build_logger(min_level="info"),
)

print(
    json.dumps(
        {
            "name": getattr(result, "name", None),
            "alias": getattr(result, "alias", TEMPLATE_NAME),
            "templateId": getattr(result, "template_id", None)
            or getattr(result, "templateId", None),
            "buildId": getattr(result, "build_id", None)
            or getattr(result, "buildId", None),
            "cpuCount": cpu_count,
            "memoryMB": memory_mb,
        },
        ensure_ascii=False,
        indent=2,
    )
)
