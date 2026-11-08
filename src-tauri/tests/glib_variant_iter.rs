#![cfg(target_os = "linux")]

use glib::{prelude::*, variant::Variant};

fn string_array() -> Variant {
    Variant::array_from_iter::<String>(
        ["alpha", "bravo", "charlie", "delta"].map(|s| s.to_variant()),
    )
}

#[test]
fn variant_strings_iterate_forward_and_backward_in_optimized_builds() {
    let value = string_array();
    assert_eq!(
        value.array_iter_str().unwrap().collect::<Vec<_>>(),
        ["alpha", "bravo", "charlie", "delta"]
    );
    assert_eq!(
        value.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
        ["delta", "charlie", "bravo", "alpha"]
    );
}

#[test]
fn variant_strings_support_mixed_ends_and_exhaustion() {
    let value = string_array();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("alpha"));
    assert_eq!(iter.next_back(), Some("delta"));
    assert_eq!(iter.nth(0), Some("bravo"));
    assert_eq!(iter.nth_back(0), Some("charlie"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}
