//! `/docs`: the OpenAPI document as one plain HTML page, with no scripts and nothing fetched from
//! elsewhere, so it works on any instance.

use serde_json::Value;
use std::fmt::Write;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn schema_name(v: &Value) -> String {
    if let Some(r) = v.get("$ref").and_then(Value::as_str) {
        return r.rsplit('/').next().unwrap_or(r).to_string();
    }
    if let Some(t) = v.get("type").and_then(Value::as_str) {
        if t == "array" {
            return format!("{}[]", v.get("items").map(schema_name).unwrap_or_default());
        }
        return t.to_string();
    }
    if let Some(one) = v.get("oneOf").and_then(Value::as_array) {
        return one
            .iter()
            .map(schema_name)
            .filter(|n| n != "null")
            .collect::<Vec<_>>()
            .join(" or ");
    }
    String::new()
}

fn body_schema(v: &Value) -> Option<String> {
    v.get("content")?
        .as_object()?
        .values()
        .next()?
        .get("schema")
        .map(schema_name)
}

/// The page for an OpenAPI document.
pub fn render(doc: &utoipa::openapi::OpenApi) -> String {
    let v = serde_json::to_value(doc).unwrap_or(Value::Null);
    let title = v.pointer("/info/title").and_then(Value::as_str).unwrap_or("API");
    let version = v.pointer("/info/version").and_then(Value::as_str).unwrap_or("");
    let about = v
        .pointer("/info/description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut h = String::new();
    let _ = write!(
        h,
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>{t} API</title><style>\
         :root{{color-scheme:light dark;--fg:#1c1c1e;--fg2:#5c5c62;--bg:#fff;--line:#d8d8de;--code:#f2f2f7}}\
         @media (prefers-color-scheme:dark){{:root{{--fg:#f2f2f7;--fg2:#a1a1a8;--bg:#000;--line:#38383a;--code:#1c1c1e}}}}\
         body{{background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:860px;padding:24px 16px 64px}}\
         h1{{font-size:28px;margin:0}}h2{{font-size:20px;margin:36px 0 8px}}h3{{font-size:16px;margin:24px 0 4px}}\
         code,pre{{font:14px ui-monospace,Menlo,monospace;background:var(--code);border-radius:6px}}code{{padding:1px 5px}}pre{{padding:10px;overflow-x:auto}}\
         .m{{font-weight:700;margin-right:6px}}.d{{color:var(--fg2)}}table{{border-collapse:collapse;width:100%;font-size:14px}}\
         td,th{{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}}th{{color:var(--fg2);font-weight:600}}\
         </style></head><body><h1>{t} {ver}</h1><p class=\"d\">{about}</p>\
         <p class=\"d\">The OpenAPI document is at <a href=\"openapi.json\"><code>openapi.json</code></a>.</p>",
        t = esc(title),
        ver = esc(version),
        about = esc(about),
    );
    h.push_str("<h2>Endpoints</h2>");
    if let Some(paths) = v.get("paths").and_then(Value::as_object) {
        for (path, ops) in paths {
            let Some(ops) = ops.as_object() else { continue };
            for (method, op) in ops {
                let summary = op.get("summary").and_then(Value::as_str).unwrap_or("");
                let detail = op.get("description").and_then(Value::as_str).unwrap_or("");
                let keyed = op.get("security").is_some();
                let _ = write!(
                    h,
                    "<h3><span class=\"m\">{}</span><code>{}</code></h3>",
                    esc(&method.to_uppercase()),
                    esc(path)
                );
                let _ = write!(
                    h,
                    "<p>{}{}</p>",
                    esc(summary),
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!(" {}", esc(detail))
                    }
                );
                if keyed {
                    h.push_str("<p class=\"d\">Needs the access key when the instance has any.</p>");
                }
                if let Some(params) = op.get("parameters").and_then(Value::as_array) {
                    h.push_str("<table><tr><th>Parameter</th><th>In</th><th>Meaning</th></tr>");
                    for p in params {
                        let _ = write!(
                            h,
                            "<tr><td><code>{}</code></td><td>{}</td><td>{}</td></tr>",
                            esc(p.get("name").and_then(Value::as_str).unwrap_or("")),
                            esc(p.get("in").and_then(Value::as_str).unwrap_or("")),
                            esc(p.get("description").and_then(Value::as_str).unwrap_or(""))
                        );
                    }
                    h.push_str("</table>");
                }
                if let Some(b) = op.get("requestBody").and_then(body_schema) {
                    let _ = write!(h, "<p>Body: <code>{}</code></p>", esc(&b));
                }
                if let Some(rs) = op.get("responses").and_then(Value::as_object) {
                    h.push_str("<table><tr><th>Status</th><th>Answer</th></tr>");
                    for (code, r) in rs {
                        let what = body_schema(r).unwrap_or_else(|| {
                            r.get("description")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string()
                        });
                        let _ = write!(
                            h,
                            "<tr><td>{}</td><td><code>{}</code></td></tr>",
                            esc(code),
                            esc(&what)
                        );
                    }
                    h.push_str("</table>");
                }
            }
        }
    }
    h.push_str("<h2>Types</h2>");
    if let Some(schemas) = v.pointer("/components/schemas").and_then(Value::as_object) {
        for (name, s) in schemas {
            let _ = write!(h, "<h3><code>{}</code></h3>", esc(name));
            if let Some(d) = s.get("description").and_then(Value::as_str) {
                let _ = write!(h, "<p>{}</p>", esc(d));
            }
            if let Some(values) = s.get("enum").and_then(Value::as_array) {
                let list: Vec<String> = values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|x| format!("<code>{}</code>", esc(x)))
                    .collect();
                let _ = write!(h, "<p>One of {}.</p>", list.join(", "));
            }
            if let Some(props) = s.get("properties").and_then(Value::as_object) {
                let required: Vec<&str> = s
                    .get("required")
                    .and_then(Value::as_array)
                    .map(|r| r.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                h.push_str("<table><tr><th>Field</th><th>Type</th><th>Meaning</th></tr>");
                for (field, p) in props {
                    let ty = schema_name(p);
                    let opt = if required.contains(&field.as_str()) {
                        ""
                    } else {
                        ", optional"
                    };
                    let _ = write!(
                        h,
                        "<tr><td><code>{}</code></td><td>{}{}</td><td>{}</td></tr>",
                        esc(field),
                        esc(&ty),
                        opt,
                        esc(p.get("description").and_then(Value::as_str).unwrap_or(""))
                    );
                }
                h.push_str("</table>");
            }
        }
    }
    h.push_str("</body></html>");
    h
}
