use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

fn sort_value(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();
            for k in keys {
                if let Some(v) = map.get(&k) {
                    sorted.insert(k, sort_value(v.clone()));
                }
            }
            Value::Object(sorted)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sort_value).collect()),
        other => other,
    }
}

#[wasm_bindgen]
pub fn normalize_json(input: &str) -> String {
    let parsed: Value = serde_json::from_str(input).unwrap_or(Value::Null);
    sort_value(parsed).to_string()
}

#[wasm_bindgen]
pub fn normalize_evidence(input: &str) -> String {
    let parsed: Value = serde_json::from_str(input).unwrap_or_else(|_| serde_json::json!({}));
    let sorted = sort_value(parsed.clone());

    let method = sorted.pointer("/method").and_then(Value::as_str).unwrap_or("UNKNOWN");
    let url = sorted.pointer("/url").and_then(Value::as_str).unwrap_or("");
    let status = sorted.pointer("/status").and_then(Value::as_i64).unwrap_or(0);

    serde_json::json!({
        "request": {
            "method": method,
            "url": url,
            "status": status
        },
        "normalized": sorted,
        "normalized_json": sorted.to_string()
    })
    .to_string()
}
