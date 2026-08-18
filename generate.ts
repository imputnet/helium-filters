// Generates a static snapshot of the uBlock Origin asset catalog and every
// filter list in it, for bundling into Helium builds as offline seed data.
// The catalog source and checksum are pinned by the helium-services
// submodule (svc/ubo/lib/assets-info.ts).

import * as AssetsInfo from './helium-services/svc/ubo/lib/assets-info.ts';
import * as Util from './helium-services/svc/ubo/lib/util.ts';

type Asset = {
    content: 'internal' | 'filters';
    contentURL: string | string[];
    cdnURLs?: string[];
    patchURLs?: string[];
    off?: boolean;
    ua?: string;
    [key: string]: unknown;
};

type AssetFile = Record<string, Asset>;

const OUT_DIR = 'out';
const LOCAL_PREFIX = 'assets/filters/';
const FETCH_CONCURRENCY = 8;

// Helium's adjustments to the upstream catalog. Only bundled catalogs are
// affected; adjustments that must reach the live assets.json proxy belong
// in the imputnet/uBlock fork instead.
const HELIUM_ADJUSTMENTS: Record<string, Partial<Asset>> = {
    'adguard-mobile-app-banners': { ua: 'mobile' },
};

// Default-enabled entries get their remote URLs removed so a bundled
// catalog causes no outgoing connections before the user consents to
// Helium services (like helium-chromium's clear-ublock-assets.js).
// Mobile-targeted lists are on by default on mobile platforms.
const isDefaultEnabled = (asset: Asset) => !asset.off || asset.ua === 'mobile';

const loadManifest = async () => {
    const assetList = await fetch(AssetsInfo.assetsUrl)
        .then((a) => a.text());
    const checksum = await Util.digest(assetList);
    if (checksum !== AssetsInfo.fileChecksum) {
        throw `assets.json checksum does not match: ${checksum}`;
    }

    return {
        manifest: JSON.parse(assetList) as AssetFile,
        checksum,
    };
};

const filterFilename = (id: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('.')) {
        throw `unsafe asset id: ${id}`;
    }

    return `${id}.txt`;
};

const fetchInPool = async (tasks: readonly (() => Promise<void>)[]) => {
    let next = 0;

    const worker = async () => {
        while (next < tasks.length) {
            await tasks[next++]();
        }
    };

    await Promise.all(
        Array.from(
            { length: Math.min(FETCH_CONCURRENCY, tasks.length) },
            worker,
        ),
    );
};

const main = async () => {
    const { manifest, checksum } = await loadManifest();

    const fileDigests: Record<string, string> = {};
    const writeOutput = async (path: string, contents: string) => {
        await Deno.writeTextFile(`${OUT_DIR}/${path}`, contents);
        fileDigests[path] = await Util.digest(contents);
    };

    // Lists removed from the catalog must not linger in the snapshot.
    await Deno.remove(OUT_DIR, { recursive: true }).catch(() => {});
    await Deno.mkdir(`${OUT_DIR}/assets/filters`, { recursive: true });

    for (const [id, adjustment] of Object.entries(HELIUM_ADJUSTMENTS)) {
        if (!(id in manifest)) {
            throw `adjustment for unknown asset: ${id}`;
        }
        Object.assign(manifest[id], adjustment);
    }

    const filterEntries = Object.entries(manifest).filter(
        ([, asset]) => asset.content === 'filters',
    );

    const failures: string[] = [];

    const tasks = filterEntries.map(([id, asset]) => async () => {
        const localPath = LOCAL_PREFIX + filterFilename(id);
        const allUrls = [asset.contentURL, asset.cdnURLs || []].flat();
        const sourceURLs = allUrls.filter(Util.isValidUrl) as string[];

        if (!sourceURLs.length) {
            throw `no source for ${id}`;
        }

        // A dead upstream must not block the whole snapshot; the run
        // fails later only if too many lists are missing.
        let text: string;
        try {
            const response = await Util.shotgunFetch(sourceURLs);
            text = await response.text();
        } catch {
            console.warn(`WARN: every source failed for ${id}`);
            failures.push(id);
            return;
        }

        await writeOutput(localPath, text);

        // The local snapshot copy becomes the first candidate; remote
        // URLs of default-enabled entries are stripped afterwards.
        asset.contentURL = [localPath, ...[asset.contentURL].flat()];

        console.log(`fetched ${id} (${text.length} bytes)`);
    });

    await fetchInPool(tasks);

    for (const asset of Object.values(manifest)) {
        if (!isDefaultEnabled(asset)) {
            continue;
        }

        asset.contentURL = [asset.contentURL].flat().filter(
            (u) => !Util.isValidUrl(u),
        );
        delete asset.cdnURLs;
        delete asset.patchURLs;
    }

    failures.sort();
    if (failures.length > filterEntries.length / 10) {
        throw `too many lists failed: ${failures.join(', ')}`;
    }

    await writeOutput(
        'assets/assets.json',
        JSON.stringify(manifest, null, '\t') + '\n',
    );

    const summary = {
        source: {
            url: AssetsInfo.assetsUrl,
            sha256: checksum,
        },
        failed: failures,
        files: Object.fromEntries(Object.entries(fileDigests).sort()),
    };
    await Deno.writeTextFile(
        `${OUT_DIR}/manifest.json`,
        JSON.stringify(summary, null, 4) + '\n',
    );

    console.log(
        `wrote ${filterEntries.length - failures.length} of `
            + `${filterEntries.length} lists and assets.json to ${OUT_DIR}/`,
    );
    if (failures.length) {
        console.warn(`WARN: missing lists: ${failures.join(', ')}`);
    }
};

await main();
