use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn normalize_evidence(input: &str) -> String {
    let parsed: Value = serde_json::from_str(input).unwrap_or_else(|_| json!({}));

    let output = json!({
        "request": {
            "method": parsed.pointer("/method").and_then(Value::as_str).unwrap_or("UNKNOWN"),
            "url": parsed.pointer("/url").and_then(Value::as_str).unwrap_or(""),
            "status": parsed.pointer("/status").and_then(Value::as_i64).unwrap_or(0)
        },
        "normalized": true
    });

    output.to_string()
}
