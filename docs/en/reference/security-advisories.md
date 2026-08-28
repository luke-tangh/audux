# Rust security advisory exceptions

[Reference and stability](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/reference/security-advisories.md)

Dependency advisories must normally be fixed or block a release. A temporary exception requires no
compatible upstream fix, an unreachable affected path, compensating validation, a public tracking
issue, and an explicit expiry date. `cargo-deny` rejects unlisted vulnerabilities and unsound or
directly unmaintained dependencies. An exception must be removed when it no longer appears in the
dependency graph; the allowlist is not a permanent baseline.

## RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g

| Field | Decision |
| --- | --- |
| Status | Temporarily accepted as `tolerable_risk` |
| Scope | Linux Tauri desktop package; Windows, macOS, and the Python sidecar do not compile this chain |
| Locked chain | `tauri 2.11.5 -> gtk 0.18.2 -> glib 0.18.5` |
| Advisory | Rust undefined behavior in `glib::VariantStrIter`; optimized calls may crash on a null pointer |
| Review deadline | `2026-10-31` or the next v1.x release, whichever comes first |
| Tracking | [#26](https://github.com/luke-tangh/audux/issues/26) |

### Reachability assessment

- Audux `Cargo.toml` does not directly depend on `glib`, `gio`, or `gtk`; application Rust code does
  not use `VariantStrIter` or `Variant::array_iter_str()`.
- Searching the resolved Rust sources from `Cargo.lock` finds no production call to
  `array_iter_str()`. Matches are limited to glib's API definition, documentation, and tests.
  External code cannot construct `VariantStrIter` directly; the affected implementation executes
  only when callers invoke and iterate that API.
- `tauri`, `tauri-runtime-wry`, `wry`, `tao`, `webkit2gtk`, and `gtk` currently constrain the GTK 3
  / glib `0.18` chain. Forcing only glib to `>=0.20.0` violates those constraints and is not a
  validated compatibility upgrade.

The evidence is tied to commit `56cabcc3dd3d47d4271df698e6501b28302daa02`. Any dependency change
requires repeating the source search and Linux release validation. Upstream references:

- [RustSec RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- [gtk-rs fix](https://github.com/gtk-rs/gtk-rs-core/pull/1343)
- [Tauri GTK4 / WebKitGTK 6 migration](https://github.com/tauri-apps/tauri/pull/14684)
- [Wry WebKitGTK 6 migration](https://github.com/tauri-apps/wry/pull/1530)

### Compensating controls and release requirements

- `deny.toml` ignores only this advisory and fails CI for other vulnerability/unsound advisories
  and directly unmaintained dependencies. `unused-ignored-advisory = "deny"` forces removal once
  the chain no longer matches.
- CI fails after the deadline; maintainers must reassess rather than silently extending it.
- Before a stable tag, the Linux release package must pass startup, window/native-dialog,
  suspend/resume, normal exit, port-conflict, and long-running validation. An abnormal crash revokes
  this exception.
- A Dependabot alert may be closed as `tolerable_risk` only after this record reaches `main`, with
  links to this page and the tracking issue. Do not mark it `inaccurate` or claim the whole glib
  dependency is unused.

### Exit conditions

Prefer a stable Tauri release with GTK4/WebKitGTK 6, then repeat the three-platform Rust checks,
signed build, Linux clean install, lifecycle tests, and long-running validation. After a successful
upgrade, remove the `deny.toml` exception, confirm an empty audit allowlist, and close
[#26](https://github.com/luke-tangh/audux/issues/26).

If the deadline arrives without a stable upstream route, reassess the actual dependency source and
runtime evidence. The explicit choices are continued risk acceptance or an audited backport of the
upstream fix; never force glib 0.20 into the GTK 3 dependency graph.
