# Content filtering lists for Helium

This repository builds static snapshots of the uBlock Origin filter-list
catalog, bundled into Helium as offline seed data, so content blocking works
from the first launch. At runtime, Helium replaces the seeds with fresh
downloads.

The assets catalog version is pinned by the [helium-services] submodule.

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
- `manifest.json`: sha256 digests of all downloaded and generated assets.

The `assets/` subtree mirrors the layout the ad blockers read.

## Local building

```sh
git submodule update --init
deno task generate
```

## License

The code in this repository is licensed under GPL-3.0.
See [LICENSE](LICENSE).

The [helium-services] submodule is licensed under AGPL-3.0.

[helium-services]: https://github.com/imputnet/helium-services
