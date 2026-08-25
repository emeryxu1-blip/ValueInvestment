#!/usr/bin/env python3
"""Execute or dry-run one AInvest quote request.

The script accepts exactly one request body source: `--template`, `--body-file`,
or `--body-json`. It infers the endpoint when possible, chooses URLs for the
selected scene (`sandbox`, `b`, or `c`), and prints a redacted dry-run payload or
sends the request.

Authentication is intentionally scene-specific: sandbox reads `AIME_API_KEY`
unless `--auth-env` is supplied; B-side requests use caller-provided apikeys;
C-side requests use caller-provided userid and sessionid values to construct the
Cookie header. Never store real auth values in templates, docs, generated files,
or command history intended for sharing.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = ROOT / "assets" / "request-templates"

ENDPOINT_NAMES = ("snapshot", "series", "multi_kline", "single_tick", "relation_list")

ENDPOINT_URLS = {
    "sandbox": {
        "snapshot": "https://open.ainvest.com/market/extquote/index/indicator/v2/snapshot",
        "series": "https://open.ainvest.com/market/extquote/index/indicator/v2/series",
        "relation_list": "https://open.ainvest.com/market/extquote/index/relation/v1/list",
        "multi_kline": "https://open.ainvest.com/market/extquote/ag/quote/v2/multi_kline",
        "single_tick": "https://open.ainvest.com/market/extquote/ag/quote/v2/single_tick",
    },
    "b": {
        "snapshot": "http://quote-apisix-gateway.hxapisix/index_api/indicator/v2/snapshot",
        "series": "http://quote-apisix-gateway.hxapisix/index_api/indicator/v2/series",
        "relation_list": "http://quote-apisix-gateway.hxapisix/index_api/relation/v1/list",
        "multi_kline": "http://quote-apisix-gateway.hxapisix/quote/v2/multi_kline",
        "single_tick": "http://quote-apisix-gateway.hxapisix/quote/v2/single_tick",
    },
    "c": {
        "snapshot": "https://extquote.ainvest.com/index_api/indicator/v2/snapshot",
        "series": "https://extquote.ainvest.com/index_api/indicator/v2/series",
        "relation_list": "https://extquote.ainvest.com/index_api/relation/v1/list",
        "multi_kline": "https://quote.ainvest.com/quote/v2/multi_kline",
        "single_tick": "https://quote.ainvest.com/quote/v2/single_tick",
    },
}

AUTH_PROFILES = {
    "sandbox": {
        "env": "AIME_API_KEY",
        "header": "Authorization",
        "prefix": "Bearer ",
        "placeholder": "Bearer <AIME_API_KEY>",
    },
    "b": {
        "header": "apikey",
        "prefix": "",
        "indicator_placeholder": "<CALLER_PROVIDED_INDEX_API_APIKEY>",
        "quote_placeholder": "<CALLER_PROVIDED_QUOTEAG_APIKEY>",
    },
    "c": {
        "header": "Cookie",
        "prefix": "",
        "placeholder": "<CALLER_PROVIDED_COOKIE>",
    },
}

INDICATOR_ENDPOINTS = {"snapshot", "series", "relation_list"}
QUOTE_ENDPOINTS = {"multi_kline", "single_tick"}

TEMPLATE_ENDPOINT_HINTS = {
    "multi-kline-minute.json": "multi_kline",
    "single-tick.json": "single_tick",
    "series-chain-history.json": "series",
    "series-etf-30d.json": "series",
    "series-prompt-self-ratings.json": "series",
    "relation-etf-holding.json": "relation_list",
    "relation-index-components.json": "relation_list",
    "relation-prompt-components.json": "relation_list",
    "relation-group-components.json": "relation_list",
    "relation-group-list.json": "relation_list",
    "relation-prompt-holding-empty.json": "relation_list",
}


def load_json_text(text, source):
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{source} is not valid JSON: {exc}") from exc


def resolve_template_path(value):
    path = Path(value)
    if path.exists():
        return path

    candidate = TEMPLATE_DIR / value
    if candidate.exists():
        return candidate

    if not value.endswith(".json"):
        candidate = TEMPLATE_DIR / f"{value}.json"
        if candidate.exists():
            return candidate

    raise FileNotFoundError(f"Template not found: {value}")


def load_body(args):
    sources = [bool(args.template), bool(args.body_file), bool(args.body_json)]
    if sum(sources) != 1:
        raise ValueError(
            "Provide exactly one of --template, --body-file, or --body-json."
        )

    if args.template:
        path = resolve_template_path(args.template)
        return load_json_text(path.read_text(encoding="utf-8"), str(path)), path.name

    if args.body_file:
        path = Path(args.body_file)
        return load_json_text(path.read_text(encoding="utf-8"), str(path)), path.name

    return load_json_text(args.body_json, "--body-json"), None


def infer_endpoint(payload, template_name=None):
    if template_name in TEMPLATE_ENDPOINT_HINTS:
        return TEMPLATE_ENDPOINT_HINTS[template_name]

    if isinstance(payload.get("code_list"), list) and "indicator" not in payload:
        time_range = payload.get("time_range")
        code_count = 0
        for item in payload.get("code_list", []):
            if isinstance(item, dict) and isinstance(item.get("codes"), list):
                code_count += len(item["codes"])
        if (
            isinstance(time_range, dict)
            and time_range.get("trade_date") == 0
            and "count" in time_range
            and "end_time" in time_range
            and code_count == 1
        ):
            return "single_tick"
        return "multi_kline"

    if (
        "relation" in payload
        and "symbol" in payload
        and "symbol_type" in payload
        and "indicator" not in payload
    ):
        return "relation_list"

    if isinstance(payload.get("time_range"), dict) and isinstance(
        payload.get("symbol"), dict
    ):
        return "series"

    if isinstance(payload.get("indicator"), list):
        return "snapshot"

    raise ValueError("Cannot infer endpoint. Pass --endpoint explicitly.")


def b_auth_value(args, endpoint_name):
    if endpoint_name in INDICATOR_ENDPOINTS:
        return (
            args.index_api_apikey or args.auth_value,
            "caller-provided index-api apikey",
        )
    if endpoint_name in QUOTE_ENDPOINTS:
        return args.quoteag_apikey or args.auth_value, "caller-provided quoteag apikey"
    return args.auth_value, "caller-provided apikey"


def resolve_auth_value(args, endpoint_name):
    scene = args.scene
    if scene == "sandbox":
        env_name = args.auth_env or AUTH_PROFILES["sandbox"]["env"]
        return os.environ.get(env_name), env_name
    if scene == "b":
        return b_auth_value(args, endpoint_name)
    return args.auth_value, "caller-provided cookie from userid/sessionid"


def build_headers(scene, auth_value, accept_language, auth_prog_id):
    profile = AUTH_PROFILES[scene]
    headers = {
        "Content-Type": "application/json",
        "Accept-Language": accept_language,
        "X-Auth-ProgId": auth_prog_id,
    }
    if auth_value:
        headers[profile["header"]] = f"{profile['prefix']}{auth_value}"
    return headers


def redact_headers(headers, scene, endpoint_name):
    redacted = dict(headers)
    profile = AUTH_PROFILES[scene]
    if scene == "b" and endpoint_name in INDICATOR_ENDPOINTS:
        redacted[profile["header"]] = profile["indicator_placeholder"]
    elif scene == "b" and endpoint_name in QUOTE_ENDPOINTS:
        redacted[profile["header"]] = profile["quote_placeholder"]
    else:
        redacted[profile["header"]] = profile["placeholder"]
    return redacted


def post_json(endpoint, payload, headers, timeout):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=data, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return response.status, load_json_text(body, "response")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw_body": body}
        return exc.code, parsed
    except urllib.error.URLError as exc:
        return 0, {
            "error": "request_failed",
            "reason": str(exc.reason),
        }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Fetch AInvest OpenAPI quote or relation data from a template or JSON body."
    )
    parser.add_argument(
        "--scene",
        choices=sorted(ENDPOINT_URLS),
        default="sandbox",
        help="Access scene: sandbox, b, or c",
    )
    parser.add_argument(
        "--endpoint",
        choices=ENDPOINT_NAMES,
        help="Endpoint name. If omitted, infer from the payload.",
    )
    parser.add_argument(
        "--template",
        help="Template filename/path under assets/request-templates, for example stock-detail.json",
    )
    parser.add_argument("--body-file", help="Path to a JSON request body")
    parser.add_argument("--body-json", help="Inline JSON request body")
    parser.add_argument(
        "--auth-value",
        help="Caller-provided auth value for b scene or complete Cookie for c scene",
    )
    parser.add_argument("--userid", help="C-side AInvest account userid")
    parser.add_argument("--sessionid", help="C-side AInvest account sessionid")
    parser.add_argument(
        "--index-api-apikey",
        help="B-side apikey for index_api indicator and relation endpoints",
    )
    parser.add_argument(
        "--quoteag-apikey",
        help="B-side apikey for quote/v2 multi_kline and single_tick",
    )
    parser.add_argument(
        "--auth-env", help="Sandbox-only environment variable holding AIME Claw API key"
    )
    parser.add_argument(
        "--api-key-env", dest="auth_env", help="Deprecated alias for --auth-env"
    )
    parser.add_argument(
        "--accept-language", default="en", help="Accept-Language header value"
    )
    parser.add_argument(
        "--auth-prog-id",
        default="7080",
        help="X-Auth-ProgId header value. Defaults to 7080.",
    )
    parser.add_argument(
        "--timeout", type=float, default=20.0, help="Request timeout in seconds"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print endpoint, headers, and body without sending the request",
    )
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print JSON output"
    )
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        payload, template_name = load_body(args)
        endpoint_name = args.endpoint or infer_endpoint(payload, template_name)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    endpoint = ENDPOINT_URLS[args.scene][endpoint_name]
    if args.scene != "c" and (args.userid or args.sessionid):
        print("error: --userid and --sessionid are only supported for c scene", file=sys.stderr)
        return 2
    if args.scene != "sandbox" and args.auth_env:
        print(
            "error: --auth-env is only supported for sandbox scene; use --auth-value for b/c scenes",
            file=sys.stderr,
        )
        return 2
    if args.scene == "c":
        if args.userid or args.sessionid:
            if not args.userid or not args.sessionid:
                print("error: --userid and --sessionid must be provided together for c scene", file=sys.stderr)
                return 2
            args.auth_value = f"userid={args.userid}; sessionid={args.sessionid}"
        elif args.auth_value and not args.auth_value.strip().startswith("userid="):
            print("error: c scene --auth-value must be a userid/sessionid Cookie", file=sys.stderr)
            return 2
    if args.scene != "b" and (args.index_api_apikey or args.quoteag_apikey):
        print(
            "error: --index-api-apikey and --quoteag-apikey are only supported for b scene",
            file=sys.stderr,
        )
        return 2
    if (
        args.scene == "b"
        and args.auth_value
        and (args.index_api_apikey or args.quoteag_apikey)
    ):
        print(
            "error: use either --auth-value or endpoint-family apikey args, not both",
            file=sys.stderr,
        )
        return 2

    auth_value, auth_source = resolve_auth_value(args, endpoint_name)
    headers = build_headers(
        args.scene, auth_value, args.accept_language, args.auth_prog_id
    )

    if args.dry_run:
        output = {
            "scene": args.scene,
            "endpoint_name": endpoint_name,
            "endpoint": endpoint,
            "auth_source": auth_source,
            "headers": redact_headers(headers, args.scene, endpoint_name),
            "body": payload,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2 if args.pretty else None))
        return 0

    if not auth_value:
        if args.scene == "sandbox":
            print(
                f"error: missing required environment variable {auth_source} for scene sandbox",
                file=sys.stderr,
            )
        elif args.scene == "b" and endpoint_name in INDICATOR_ENDPOINTS:
            print(
                "error: missing required --index-api-apikey or --auth-value for b scene index-api endpoint",
                file=sys.stderr,
            )
        elif args.scene == "b" and endpoint_name in QUOTE_ENDPOINTS:
            print(
                "error: missing required --quoteag-apikey or --auth-value for b scene quote endpoint",
                file=sys.stderr,
            )
        else:
            print(
                f"error: missing required --auth-value for scene {args.scene}",
                file=sys.stderr,
            )
        return 2

    status, response = post_json(endpoint, payload, headers, args.timeout)
    output = {
        "http_status": status,
        "scene": args.scene,
        "endpoint_name": endpoint_name,
        "endpoint": endpoint,
        "response": response,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    sys.exit(main())
