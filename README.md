# Content-filtering assets for Helium

This repository builds Helium's bundled content-filtering snapshot: the uBlock
Origin filter-list catalog and lists, plus the scriptlet and redirect resources
used by the Rust-based adblocker. This lets content blocking work from the first
launch. At runtime, Helium can replace the bundled filter-list seeds with fresh
downloads.

The assets catalog version is pinned by the [helium-services] submodule. The
matching uBlock source used to build scriptlet and redirect resources is pinned
by the [uBlock] submodule.

## Bundled third-party lists

Releases redistribute filter lists unmodified, as published by their upstream
sources. Every list is the work of its authors and remains under its own
license. This repository claims no ownership of, and adds no terms to any of
them. Each list's homepage and license can be found through the `supportURL`
field of its entry in `assets/assets.json`.

Major sources include [uBlock Origin filters], [EasyList and EasyPrivacy],
[AdGuard filters], [Peter Lowe's list], and [URLhaus].

[uBlock Origin filters]: https://github.com/uBlockOrigin/uAssets
[EasyList and EasyPrivacy]: https://easylist.to/
[AdGuard filters]: https://github.com/AdguardTeam/AdguardFilters
[Peter Lowe's list]: https://pgl.yoyo.org/adservers/
[URLhaus]: https://gitlab.com/malware-filter/urlhaus-filter

## Release contents

- `assets/assets.json`: the filter-list catalog with a local
  `assets/filters/<id>.txt` candidate. Default entries have their remote URLs
  removed, so a bundled catalog causes no outgoing connections before the user
  consents to Helium services. This is required for uBlock Origin in Helium.
- `assets/filters/<id>.txt`: every filter list from the catalog mentioned above.
- `resources.json`: uBlock's built-in scriptlets and redirect resources in the
  format consumed by `adblock-rust`.
- `manifest.json`: sha256 digests of all downloaded and generated assets.

The `assets/` subtree mirrors the layout the ad blockers read.

## Local building

```sh
git submodule update --init
deno task generate
```

## License

The code in this repository is licensed under GPL-3.0. See [LICENSE](LICENSE).

The [helium-services] submodule is licensed under AGPL-3.0. The [uBlock]
submodule and resources derived from it are licensed under GPL-3.0.

[helium-services]: https://github.com/imputnet/helium-services
[uBlock]: https://github.com/imputnet/uBlock
